import { describe, expect, it } from "vitest";
import { compareConfirmed, reconcileInvoice, type ReviewedLine, type ReviewedPromise } from "@/lib/comparison";
import { invoiceBucket, invoiceReviewDraft, invoiceSummary } from "@/lib/invoice-results";
const line = (id: string, description: string, amount: number, order_no = "ORD-1"): ReviewedLine => ({ id, description, amount, order_no, reference_no: order_no, tax_amount: 100, type: "charge", date: null, bank_ref: null });
const promise = (id: string, item: string, promised_amount: number | null, notes: string | null = null): ReviewedPromise => ({ id, item, promised_amount, notes, original_charge: null, promised_on: null, reference_no: null, transaction_id: null, bank_ref: null, status_text: null, source: "Lab", promise_kind: "price_list" });
describe("lab result rules", () => {
  it("counts repeated sales tax exactly once for each order number", () => {
    const lines = [line("1", "Crown", 500), line("2", "Model", 200), { ...line("3", "Crown", 300, "ORD-2"), tax_amount: 20 }];
    expect(reconcileInvoice(lines, 1000, { sales_tax: 120, bill_total: 1120 })).toMatchObject({ tax_total: "120.00", tax_matches: true, total: "1120.00", total_matches: true });
    const result = compareConfirmed(lines, [promise("p", "Crown", 500)], "2026-10-19", { orders_subtotal: 1000, sales_tax: 120 });
    expect(result.issues.some((i) => i.includes("Sales Tax"))).toBe(false);
  });
  it("warns when the distinct-order tax sum still differs", () => {
    const result = compareConfirmed([line("1", "Crown", 100), line("2", "Crown", 100)], [promise("p", "Crown", 100)], "2026-10-19", { sales_tax: 101 });
    expect(result.issues.some((i) => i.includes("Sales Tax"))).toBe(true);
  });
  it("reconciles the concrete items, tax, credits and invoice total", () => {
    const lines = [{ ...line("1", "Crown", 10000), tax_amount: 1000 }, { ...line("2", "Model", 502, "ORD-2"), tax_amount: 11.10 }, { ...line("3", "Credit", 80), type: "credit" as const }];
    expect(reconcileInvoice(lines, 10502, { sales_tax: 1011.10, bill_total: 11433.10 })).toMatchObject({ items_total: "10502.00", matches: true, tax_total: "1011.10", tax_matches: true, credits_total: "80.00", credits_matches: true, total: "11433.10", total_matches: true });
  });
  it("does not claim reconciliation when printed totals are missing", () => {
    expect(reconcileInvoice([line("1", "Crown", 100)], null, {})).toMatchObject({ matches: null, tax_matches: null, credits_matches: null, total_matches: null });
  });
  it("puts partial dentures of every material in staged even without a contract match", () => {
    const items = ["Acrylic Partial Denture", "Chrome-Cobalt partial", "Flexible partial denture", "Partial Zirconia"];
    const result = compareConfirmed(items.map((item, index) => line(String(index), item, 500)), [promise("p", "Crown", 100)], "2026-10-19");
    expect(result.findings).toHaveLength(4);
    for (const f of result.findings) expect(f).toMatchObject({ disposition: "staged", flagged: false, promised: null, overcharge: null, order_no: "ORD-1", charged: "500.00" });
  });
  it("assigns every charge once with exact bucket totals and overcharge maths", () => {
    const result = compareConfirmed([line("equal", "Crown", 100), line("over", "Crown", 125), line("stage", "Acrylic partial denture", 300), line("zero", "Removable Model", 0), line("unknown", "Additional Wax Rim", 40)], [promise("p", "Crown", 100)], "2026-10-19");
    expect(result.findings.map(invoiceBucket)).toEqual(["matches", "overcharged", "staged", "included", "review"]);
    const summary = invoiceSummary(result.findings);
    expect(summary).toMatchObject({ overcharge_count: 1, overcharge_total: "25.00" });
    expect(summary.buckets.filter((b) => b.count).map((b) => [b.key, b.count, b.total])).toEqual([["matches", 1, "100.00"], ["overcharged", 1, "125.00"], ["staged", 1, "300.00"], ["included", 1, "0.00"], ["review", 1, "40.00"]]);
    expect(summary.buckets.flatMap((b) => b.items).map((f) => f.line_id)).toHaveLength(5);
  });
  it("retains non-fixed and below-list items without calling them equal or unmatched", () => {
    const result = compareConfirmed([line("alloy", "Alloy Crown", 50), line("below", "Model", 50)], [promise("a", "Alloy Crown", 100, "+ Alloy"), promise("b", "Model", 100)], "2026-10-19");
    expect(result.findings.map(invoiceBucket)).toEqual(["not_comparable", "below"]);
  });
  it("produces one billing message containing all review orders and exact amounts", () => {
    const result = compareConfirmed([line("a", "Additional Wax Rim", 40, "100006792070399"), line("b", "Extra custom tray", 55.25, "ORD-2")], [promise("p", "Crown", 100)], "2026-10-19");
    const text = invoiceReviewDraft(result.findings, "Lab", "USD");
    expect(text).toContain("100006792070399, $40.00");
    expect(text).toContain("ORD-2, $55.25");
    expect(text).not.toContain("overcharge");
    expect((text.match(/Subject:/g) ?? []).length).toBe(1);
  });
});