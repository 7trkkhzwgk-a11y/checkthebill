import { describe, expect, it } from "vitest";
import { compareConfirmed, groupInvoiceMatches, matchInvoiceItems, type ReviewedLine, type ReviewedPromise } from "@/lib/comparison";
import { invoiceBucket, invoiceReviewDraft } from "@/lib/invoice-results";

const contract = (item: string, price: number): ReviewedPromise => ({ id: item, item, promised_amount: price, original_charge: null, promised_on: null, reference_no: null, transaction_id: null, bank_ref: null, status_text: null, source: "Synthetic Lab", promise_kind: "price_list" });
const line = (description: string, amount: number): ReviewedLine => ({ id: description, description, amount, type: "charge", date: null, order_no: "SYN-ORDER", reference_no: "SYN-ORDER", bank_ref: null });
const wax = "Signature New Dentures & Overdentures - Wax bite rim workflow";
const reference = "Signature New Dentures & Overdentures - Reference workflow";
const aliases = [
  ["Signature Denture Bundle - Wax Rim Workflow", wax, 199],
  ["Signature Denture - New Denture, Wax Rim Workflow", wax, 199],
  ["Signature Denture - New Denture, Reference Workflow", reference, 149],
  ["Monolithic Try-in", "Monolithic Try-in (per arch)", 79],
  ["Crown N - Zirconia Monolithic", "Zirconia Monolithic", 75],
  ["Model - Dual Full Arch", "Model: Dual Full Arch Articulated", 35],
] as const;
const promises = [contract(wax, 199), contract(reference, 149), contract("Monolithic Try-in (per arch)", 79), contract("Zirconia Monolithic", 75), contract("Model: Dual Full Arch Articulated", 35)];

describe("fixed invoice aliases", () => {
  it.each(aliases)("matches %s to %s at $%s before fuzzy matching", (name, target, price) => {
    const rows = [line(name, price)];
    const candidates = [...promises, contract(name, price + 100)];
    expect(matchInvoiceItems(rows, candidates)[0]).toMatchObject({ promise_id: target, confidence: 1, quantity: 1, disposition: "matched" });
    expect(compareConfirmed(rows, candidates, "2026-10-19").findings[0]).toMatchObject({ promised: price.toFixed(2), overcharge: "0.00", flagged: false });
  });
  it("compares two wax rim bundles against exactly $398", () => {
    const rows = [line("Signature Denture Bundle - Wax Rim Workflow (x2)", 398)];
    expect(matchInvoiceItems(rows, promises)[0]).toMatchObject({ promise_id: wax, quantity: 2, confidence: 1 });
    expect(compareConfirmed(rows, promises, "2026-10-19").findings[0]).toMatchObject({ promised: "398.00", overcharge: "0.00", flagged: false });
    expect(compareConfirmed([{ ...rows[0], amount: 400 } as ReviewedLine], promises, "2026-10-19").findings[0]).toMatchObject({ overcharge: "2.00", flagged: true });
  });
  it("keeps zero-dollar removable models included without confirmation", () => {
    const rows = [line("Removable Model - Dual Full Arch", 0)];
    const matches = matchInvoiceItems(rows, promises);
    expect(matches[0]).toMatchObject({ disposition: "included", promise_id: null });
    expect(groupInvoiceMatches(rows, matches)).toEqual([]);
    expect(invoiceBucket(compareConfirmed(rows, promises, "2026-10-19").findings[0] as NonNullable<ReturnType<typeof compareConfirmed>["findings"][number]>)).toBe("included");
  });
  it.each(["Partial Denture - Chrome-Cobalt", "Partial Denture - Acrylic", "Partial Denture - Flexible"])("keeps %s staged without confirmation or comparison", (name) => {
    const rows = [line(name, 500)];
    const matches = matchInvoiceItems(rows, promises);
    expect(matches[0]?.disposition).toBe("staged");
    expect(groupInvoiceMatches(rows, matches)).toEqual([]);
    expect(compareConfirmed(rows, promises, "2026-10-19").findings[0]).toMatchObject({ disposition: "staged", promised: null, overcharge: null, flagged: false });
  });
  it("leaves Additional Wax Rim in review without its own contract entry", () => {
    expect(matchInvoiceItems([line("Additional Wax Rim", 40)], promises)[0]).toMatchObject({ disposition: "no_contract", promise_id: null });
  });
  it("does not invent an alias price or select the wrong workflow if the target is missing", () => {
    expect(matchInvoiceItems([line("Signature Denture Bundle - Wax Rim Workflow", 199)], [contract(reference, 149)])[0]).toMatchObject({ disposition: "no_contract", promise_id: null });
  });
  it("takes the price from the saved contract, not a hardcoded alias amount", () => {
    expect(compareConfirmed([line("Signature Denture Bundle - Wax Rim Workflow", 199)], [contract(wax, 200)], "2026-10-19").findings[0]).toMatchObject({ promised: "200.00", overcharge: "-1.00", flagged: false });
  });
  it("includes only review items in the combined review message", () => {
    const rows = [...aliases.map(([name, , price]) => line(name, price)), line("Additional Wax Rim", 40), line("Partial Denture - Acrylic", 500), line("Removable Model - Dual Full Arch", 0)];
    const findings = compareConfirmed(rows, promises, "2026-10-19").findings;
    expect(findings.map(invoiceBucket)).toEqual(["matches", "matches", "matches", "matches", "matches", "matches", "review", "staged", "included"]);
    const draft = invoiceReviewDraft(findings, "Synthetic Lab", "USD");
    expect(draft).toContain("Additional Wax Rim");
    for (const row of rows.filter((row) => row.description !== "Additional Wax Rim")) expect(draft).not.toContain(row.description);
  });
});