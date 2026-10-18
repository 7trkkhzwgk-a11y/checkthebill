import { describe, expect, it } from "vitest";
import { assertExactNumbers, formatCurrency, presentFinding } from "@/lib/message-format";
import { compareConfirmed, draftFacts } from "@/lib/comparison";

const promise = { id: "p", item: "Train ticket refund", pnr: "1234567890", original_charge: 7475.40, promised_amount: 7180, promised_on: "2026-09-24", reference_no: "100006792070399", transaction_id: "100001447873288", bank_ref: "", source: "IRCTC", status_text: null, promise_kind: "refund" };
const line = { id: "l", date: null, description: "Train ticket", amount: 7475.40, type: "charge" as const, reference_no: promise.transaction_id, bank_ref: null };
function finding(bankRef = "") {
  const f = compareConfirmed([line], [{ ...promise, bank_ref: bankRef }], "2026-10-18").findings[0];
  if (!f) throw new Error("No finding");
  return presentFinding(f, promise, "Example Bank", "INR");
}
describe("result and message facts", () => {
  it("formats INR with rupee symbol, commas and exact two decimals", () => {
    expect(formatCurrency("7475.40", "INR")).toBe("₹7,475.40");
    expect(formatCurrency("7180.00", "INR")).toBe("₹7,180.00");
  });
  it("formats USD with dollar symbol without converting amounts", () => {
    expect(formatCurrency("7475.40", "USD")).toBe("$7,475.40");
  });
  it("does not invent a currency when it is absent", () => {
    expect(formatCurrency("7475.40", null)).toBe("7,475.40");
  });
  it("resolves the merchant from the promise and bank from the issuer", () => {
    expect(finding().contact_name).toBe("IRCTC");
    expect(finding("BANK-123").contact_name).toBe("Example Bank");
  });
  it("passes exact PNR, refund and transaction identifiers and computed days", () => {
    expect(draftFacts(finding())).toMatchObject({ recipient: "IRCTC", pnr: "1234567890", refund_id: "100006792070399", transaction_id: "100001447873288", days_waiting: 24, refund_promised: "7180.00" });
  });
  it("excludes merchant-kept amounts from AI facts", () => {
    expect(draftFacts(finding())).not.toHaveProperty("kept_by_merchant");
    expect(draftFacts(finding())).not.toHaveProperty("charged");
  });
  it("accepts exact formatted amounts, dates, days and whole IDs", () => {
    expect(() => assertExactNumbers("₹7,180.00 on 2026-09-24, after 24 days. Refund ID 100006792070399.", ["₹7,180.00", "2026-09-24", 24, "100006792070399"])).not.toThrow();
  });
  it("rejects changed currency amounts even if their numeric chunks are allowed", () => {
    expect(() => assertExactNumbers("₹7,180.24", ["₹7,180.00", 24])).toThrow();
    expect(() => assertExactNumbers("7180.00", ["₹7,180.00"])).toThrow();
  });
  it("rejects altered identifiers and invented elapsed days", () => {
    expect(() => assertExactNumbers("100006792070398", ["100006792070399"])).toThrow();
    expect(() => assertExactNumbers("25 days", [24])).toThrow();
  });
});