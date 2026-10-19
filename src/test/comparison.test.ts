import { describe, expect, it } from "vitest";
import { compareConfirmed, countWordsChanged, draftFacts, isBilateral, isComparablePromise, lineQuantity, matchInvoiceItems, type ReviewedLine, type ReviewedPromise } from "@/lib/comparison";

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
    expect(draftFacts(finding)).toMatchObject({ refund_promised: "7180.00", refund_id: "1234567890123456", transaction_id: "9876543210987654", missing_amount: "7180.00" });
    expect(draftFacts(finding)).not.toHaveProperty("kept_by_merchant");
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

describe("price-list matching and flags", () => {
  const priceList = (item: string, promised_amount: number | null, notes: string | null = null): ReviewedPromise =>
    ({ id: `p-${item}`, item, original_charge: null, promised_amount, reference_no: null, transaction_id: null, bank_ref: "", promised_on: null, status_text: null, source: "Price list", promise_kind: "price_list", notes });
  const invoiceLine = (description: string, amount: number, id = description): ReviewedLine =>
    ({ id, date: "2026-10-01", description, amount, type: "charge", reference_no: null, bank_ref: null });

  it("matches invoice items to price-list rows by keywords", () => {
    const promises = [priceList("Cast Metal Chrome Cobalt", 5000), priceList("Signature denture wax bite rim workflow", 1200)];
    const matches = matchInvoiceItems([invoiceLine("Chrome-Cobalt partial", 5000), invoiceLine("Wax Rim Workflow", 1200)], promises);
    expect(matches.find((m) => m.line_id === "Chrome-Cobalt partial")?.promise_id).toBe("p-Cast Metal Chrome Cobalt");
    expect(matches.find((m) => m.line_id === "Wax Rim Workflow")?.promise_id).toBe("p-Signature denture wax bite rim workflow");
  });
  it("reads (x2) as quantity 2 and teeth on both sides as bilateral", () => {
    expect(lineQuantity("Crown (x2)")).toBe(2);
    expect(isBilateral("Crowns teeth 14 and 24")).toBe(true);
    expect(isBilateral("Crown tooth 14")).toBe(false);
  });
  it("flags only charges above the agreed price times quantity", () => {
    const promises = [priceList("Crown", 1000)];
    const result = compareConfirmed([invoiceLine("Crown (x2)", 2500)], promises, "2026-10-18");
    expect(result.findings[0]).toMatchObject({ flagged: true, recipient: "VENDOR", overcharge: "500.00", promised: "2000.00" });
  });
  it("labels below-list charges without flagging them as errors", () => {
    const promises = [priceList("Crown", 1000)];
    const result = compareConfirmed([invoiceLine("Crown", 800)], promises, "2026-10-18");
    expect(result.findings[0]).toMatchObject({ flagged: false, note: "Below list price – check if this is a discount or staged billing." });
    expect(result.status).toBe("clear");
  });
  it("skips not-comparable price-list rows", () => {
    expect(isComparablePromise(priceList("Crown + Alloy", 1000))).toBe(false);
    expect(isComparablePromise(priceList("Denture", null, "N/A"))).toBe(false);
    expect(isComparablePromise(priceList("Bridge", 500, "500-900 range"))).toBe(false);
    expect(isComparablePromise(priceList("Crown", 1000))).toBe(true);
  });
  it("warns when pre-tax items or tax do not add up to the printed invoice totals", () => {
    const promises = [priceList("Crown", 1000)];
    const result = compareConfirmed([{ ...invoiceLine("Crown", 900), tax_amount: 50 }], promises, "2026-10-18", { orders_subtotal: 1000, sales_tax: 80 });
    expect(result.status).toBe("incomplete");
    expect(result.issues.some((i) => i.includes("Orders subtotal"))).toBe(true);
    expect(result.issues.some((i) => i.includes("Sales Tax"))).toBe(true);
  });
  it("honours a user-confirmed low-confidence match", () => {
    const promises = [priceList("Abutment crown", 3000), priceList("Crown", 1000)];
    const result = compareConfirmed([invoiceLine("Crown", 3500)], promises, "2026-10-18", { confirmed_matches: { Crown: "p-Abutment crown" } });
    expect(result.findings[0]).toMatchObject({ promise_id: "p-Abutment crown", overcharge: "500.00", flagged: true });
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
describe("staged items", () => {
  it("labels staged items without flagging them, even above the agreed price", () => {
    const promises = [priceList("Partial denture", 5000)];
    const result = compareConfirmed([{ ...invoiceLine("Partial denture stage 1", 3000), order_no: "ORD-1" }], promises, "2026-10-18");
    expect(result.findings[0]).toMatchObject({ flagged: false, note: "Staged – check total when order completes." });
    expect(result.status).toBe("clear");
  });
  it("treats rows marked staged in notes as staged", () => {
    const promises = [priceList("Framework", 4000, "Staged billing")];
    const result = compareConfirmed([invoiceLine("Framework", 4500)], promises, "2026-10-18");
    expect(result.findings[0].flagged).toBe(false);
    expect(result.findings[0].note).toContain("Staged");
  });
  it("still flags fixed-price items above the contract price in the same invoice", () => {
    const promises = [priceList("Partial denture", 5000), priceList("Crown", 1000)];
    const result = compareConfirmed([invoiceLine("Partial denture stage 1", 6000), invoiceLine("Crown", 1200)], promises, "2026-10-18");
    expect(result.findings.find((f) => f.item === "Partial denture")?.flagged).toBe(false);
    expect(result.findings.find((f) => f.item === "Crown")).toMatchObject({ flagged: true, overcharge: "200.00" });
    expect(result.status).toBe("flagged");
  });
});
