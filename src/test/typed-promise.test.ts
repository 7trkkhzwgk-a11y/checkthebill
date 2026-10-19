import { describe, expect, it } from "vitest";
import { compareConfirmed, type ReviewedLine, type ReviewedPromise } from "@/lib/comparison";
import { typedTaxMath, typedPromiseDraft, type TypedDetails } from "@/lib/typed-promise";
import { presentFinding } from "@/lib/message-format";

const details: TypedDetails = { kind: "price", tax_inclusive: false, bill_amount_includes_tax: false, taxes: [{ label: "GST", rate: 18, taxable_amount: null }] };
const line: ReviewedLine = { id: "11111111-1111-4111-8111-111111111111", description: "Plan", amount: 499, type: "charge", tax_amount: 90, date: null, reference_no: null, bank_ref: null };
const promise: ReviewedPromise = { id: "22222222-2222-4222-8222-222222222222", item: "Plan", promised_amount: 499, original_charge: null, promised_on: null, reference_no: null, transaction_id: null, bank_ref: "", status_text: null, source: "Example Telecom", promise_kind: "contract", typed_details: details };
describe("typed promises", () => {
  it("calculates 18 percent GST on 499 in code", () => {
    expect(typedTaxMath(499, details)).toMatchObject({ base: "499.00", total: "588.82", taxes: [{ expected: "89.82" }] });
  });
  it("backs tax out of the stated 499 inclusive price, not adds it", () => {
    expect(typedTaxMath(499, { ...details, tax_inclusive: true })).toMatchObject({ base: "422.88", total: "499.00", taxes: [{ expected: "76.12" }] });
  });
  it("flags the exact billed tax difference", () => {
    expect(compareConfirmed([line], [promise], "2026-10-19").findings[0]).toMatchObject({ flagged: true, tax_checks: [{ expected: "89.82", billed: "90.00", difference: "0.18" }] });
  });
  it("keeps correctly taxed bills clear", () => {
    expect(compareConfirmed([{ ...line, tax_amount: 89.82 }], [promise], "2026-10-19").status).toBe("clear");
  });
  it("does not add tax twice to an inclusive billed amount", () => {
    expect(compareConfirmed([{ ...line, amount: 499, tax_amount: 76.12 }], [{ ...promise, typed_details: { ...details, tax_inclusive: true, bill_amount_includes_tax: true } }], "2026-10-19").findings[0]).toMatchObject({ charged: "499.00", promised: "499.00", flagged: false });
  });
  it("requires a billed total or confirmed bill tax basis", () => {
    expect(compareConfirmed([line], [{ ...promise, typed_details: { ...details, bill_amount_includes_tax: null } }], "2026-10-19").status).toBe("incomplete");
  });
  it("reports missing tax as incomplete rather than verified", () => {
    expect(compareConfirmed([{ ...line, tax_amount: null }], [promise], "2026-10-19").status).toBe("incomplete");
  });
  it("does not assume whether an unspecified tax is inclusive", () => {
    expect(compareConfirmed([line], [{ ...promise, typed_details: { ...details, tax_inclusive: null } }], "2026-10-19").status).toBe("incomplete");
  });
  it("calculates cess independently on an explicitly stated base", () => {
    expect(typedTaxMath(499, { ...details, taxes: [...details.taxes, { label: "Cess", rate: 2, taxable_amount: 100 }] })).toMatchObject({ total: "590.82", taxes: [{ expected: "89.82" }, { expected: "2.00" }] });
  });
  it("checks a verbal 7180 refund without inventing an original charge or date", () => {
    const result = compareConfirmed([line], [{ ...promise, promised_amount: 7180, typed_details: { kind: "refund", tax_inclusive: null, taxes: [] } }], "2026-10-19");
    expect(result.findings[0]).toMatchObject({ flagged: true, missing_amount: "7180.00", promised_on: null, kept_by_merchant: null });
  });
  it("compares the agreed crown price 75 without tax", () => {
    const result = compareConfirmed([{ ...line, description: "Crown", amount: 80, tax_amount: null }], [{ ...promise, item: "Crown", promised_amount: 75, typed_details: { kind: "price", tax_inclusive: null, taxes: [] } }], "2026-10-19");
    expect(result.findings[0]).toMatchObject({ flagged: true, overcharge: "5.00", promised: "75.00" });
  });
  it("routes verbal promises to the company instead of claiming a refund document", () => {
    const f = compareConfirmed([line], [promise], "2026-10-19").findings[0];
    if (!f) throw new Error("Missing finding");
    const presented = presentFinding(f, promise, "Example Bank", "INR");
    expect(presented.contact_name).toBe("Example Telecom");
    expect(presented.recipient).toBe("VENDOR");
    const draft = typedPromiseDraft(presented);
    expect(draft).toContain("I was informed that");
    expect(draft).toContain("Please confirm what I was told");
    expect(draft).not.toContain("refund ID");
  });
});