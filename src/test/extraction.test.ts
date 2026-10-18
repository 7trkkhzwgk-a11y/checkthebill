import { describe, expect, it } from "vitest";
import { normalizeExtraction, toDate, type Extraction } from "@/lib/extraction";

const refund = { item: "Train ticket refund", original_charge: 7475.40, promised_amount: 7180.00, reference_no: "1234567890123456", transaction_id: "9876543210987654", bank_ref: null, promised_on: null, status_text: "Refund amount has been sent" };
const base: Extraction = { issuer: "Rail", source: "Refund confirmation", bill_total: 7475.40, bill_lines: [], promise_kind: "refund", refund, agreed_items: [] };

describe("extraction normalization", () => {
  it("stores one refund with the original charge and total refund amount separately", () => {
    const result = normalizeExtraction(base);
    expect(result.promise_rows).toHaveLength(1);
    expect(result.promise_rows[0]).toMatchObject({ original_charge: 7475.40, promised_amount: 7180.00, item: "Train ticket refund", status_text: "Refund amount has been sent" });
  });
  it("preserves complete refund, transaction and bank references and blank bank reference", () => {
    expect(normalizeExtraction(base).promise_rows[0]).toMatchObject({ reference_no: "1234567890123456", transaction_id: "9876543210987654", bank_ref: "" });
    expect(normalizeExtraction({ ...base, refund: { ...refund, bank_ref: "1234567890123456789" } }).promise_rows[0].bank_ref).toBe("1234567890123456789");
  });
  it("excludes balances, totals, amount due, headers and footers but keeps charges and credits", () => {
    const descriptions = ["Opening balance", "Closing balance", "Total", "Amount due", "Header", "Footer notes", "Train ticket", "Train refund"];
    const result = normalizeExtraction({ ...base, bill_lines: descriptions.map((description, i) => ({ kind: i === 4 ? "header" : i === 5 ? "footer" : "transaction", description, date: null, amount: 100, type: i === 7 ? "credit" : "charge", reference_no: null, bank_ref: null })) });
    expect(result.bill_lines.map((l) => l.description)).toEqual(["Train ticket", "Train refund"]);
    expect(result.bill_total).toBe(7475.40);
  });
  it("keeps one agreed-price promise per contract or price-list item", () => {
    for (const promise_kind of ["contract", "price_list"] as const) {
      expect(normalizeExtraction({ ...base, promise_kind, refund: null, agreed_items: [{ ...refund, item: "Item A", promised_amount: 10 }, { ...refund, item: "Item B", promised_amount: 20 }] }).promise_rows.map((p) => p.promised_amount)).toEqual([10, 20]);
    }
  });
  it("leaves missing or placeholder dates empty and accepts real printed dates", () => {
    expect(normalizeExtraction(base).promise_rows[0].promised_on).toBeNull();
    expect(toDate("mm/dd/yyyy")).toBeNull();
    expect(toDate("2026-02-30")).toBeNull();
    expect(toDate("2026-10-18")).toBe("2026-10-18");
  });
});