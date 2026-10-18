import { describe, expect, it } from "vitest";
import { compareConfirmed, countWordsChanged, draftFacts, type ReviewedLine, type ReviewedPromise } from "@/lib/comparison";

const charge: ReviewedLine = { id: "charge", date: "2026-10-01", description: "Train ticket", amount: 7475.40, type: "charge", reference_no: "9876543210987654", bank_ref: null };
const refund: ReviewedPromise = { id: "promise", item: "Train ticket refund", original_charge: 7475.40, promised_amount: 7180.00, reference_no: "1234567890123456", transaction_id: "9876543210987654", bank_ref: "", promised_on: "2026-10-08", status_text: "Refund amount has been sent", source: "Refund confirmation", promise_kind: "refund" };
const credit: ReviewedLine = { ...charge, id: "credit", type: "credit", reference_no: refund.reference_no, amount: 7180 };
const compare = (lines = [charge], promise = refund) => compareConfirmed(lines, [promise], "2026-10-18");

describe("confirmed refund comparison", () => {
  it("prefers the transaction reference to an equal-amount unrelated charge", () => {
    const result = compare([{ ...charge, id: "unrelated", reference_no: "other" }, charge]);
    expect(result.findings[0]?.line_id).toBe("charge");
    expect(result.findings.filter((f) => f.flagged).map((f) => f.line_id)).toEqual(["charge"]);
  });
  it("falls back to the original charge amount if its reference is absent", () => {
    expect(compare([{ ...charge, reference_no: null }]).findings[0]?.line_id).toBe("charge");
  });
  it("calculates exact kept amount, expected credit, zero found and UTC days waiting", () => {
    expect(compare().findings[0]).toMatchObject({ charged: "7475.40", promised: "7180.00", kept_by_merchant: "295.40", credit_expected: "7180.00", credit_found: "0.00", days_waiting: 10, flagged: true });
  });
  it("routes a missing credit with blank bank reference to MERCHANT", () => {
    expect(compare().findings[0]?.recipient).toBe("MERCHANT");
  });
  it("routes a missing credit with bank reference to BANK", () => {
    expect(compare([charge], { ...refund, bank_ref: "BANK-123" }).findings[0]?.recipient).toBe("BANK");
  });
  it("finds an exact amount credit even without a matching refund reference", () => {
    expect(compare([charge, { ...credit, reference_no: "other" }]).findings[0]).toMatchObject({ credit_found: "7180.00", flagged: false, recipient: null });
    expect(compare([charge, credit]).status).toBe("clear");
  });
  it("flags only the matched charge for partial credit identified by refund ID", () => {
    expect(compare([charge, { ...credit, amount: 7000 }]).findings[0]).toMatchObject({ line_id: "charge", credit_found: "7000.00", flagged: true, recipient: "MERCHANT" });
  });
  it("prefers a reference-matched partial credit over an unrelated exact amount", () => {
    expect(compare([charge, { ...credit, amount: 7000 }, { ...credit, id: "unrelated-credit", reference_no: "unrelated" }]).findings[0]?.credit_found).toBe("7000.00");
  });
  it("does not flag ambiguous charges or claim the bill is correct", () => {
    expect(compare([charge, { ...charge, id: "second" }])).toMatchObject({ status: "incomplete", findings: [expect.objectContaining({ flagged: false, line_id: null })] });
  });
  it("leaves days waiting empty when no refund date exists", () => {
    expect(compare([charge], { ...refund, promised_on: null }).findings[0]?.days_waiting).toBeNull();
  });
  it("keeps a zero refund expectation unflagged", () => {
    expect(compare([charge], { ...refund, promised_amount: 0 }).findings[0]?.flagged).toBe(false);
  });
  it("sends only computed facts and full identifiers to message AI", () => {
    const finding = compare().findings[0];
    if (!finding) throw new Error("Missing finding");
    expect(draftFacts(finding)).toMatchObject({ charged: "7475.40", refund_promised: "7180.00", refund_id: "1234567890123456", transaction_id: "9876543210987654", recipient: "MERCHANT" });
    expect(draftFacts(finding)).not.toHaveProperty("description");
    expect(draftFacts(finding)).not.toHaveProperty("status_text");
  });
});

describe("confirmed invoice comparison", () => {
  const agreed = { ...refund, item: "Train ticket", original_charge: null, promised_amount: 7180, transaction_id: null, source: "Price list", promise_kind: "price_list" };
  it("matches the same item and computes per-line overcharge routed to VENDOR", () => {
    expect(compare([charge], agreed).findings[0]).toMatchObject({ line_id: "charge", overcharge: "295.40", flagged: true, recipient: "VENDOR" });
  });
  it("flags no other lines, including invoice credits or lower-price items", () => {
    const result = compareConfirmed([charge, { ...charge, id: "lower", description: "Other", amount: 10 }, credit], [agreed, { ...agreed, id: "other-promise", item: "Other", promised_amount: 20 }], "2026-10-18");
    expect(result.findings.filter((f) => f.flagged).map((f) => f.line_id)).toEqual(["charge"]);
  });
  it("does not report unmatched invoice items as clear", () => {
    expect(compare([{ ...charge, description: "Unknown item" }], agreed).status).toBe("incomplete");
  });
});

describe("word edits", () => {
  it("counts substitutions, inserted and deleted words against the original draft", () => {
    expect(countWordsChanged("Please send refund", "Please trace refund")).toBe(1);
    expect(countWordsChanged("Please send refund", "Please send my refund soon")).toBe(2);
    expect(countWordsChanged("Please send my refund", "Please send refund")).toBe(1);
    expect(countWordsChanged("Please send refund", "Please send refund")).toBe(0);
  });
});