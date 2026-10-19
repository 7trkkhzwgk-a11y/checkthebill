import Decimal from "decimal.js";
import type { Finding } from "@/lib/comparison";
import { assertExactNumbers, formatCurrency } from "@/lib/message-format";

export const INVOICE_BUCKETS = [
  { key: "matches", label: "Matches contract" },
  { key: "overcharged", label: "Overcharged" },
  { key: "staged", label: "Staged – check when order completes" },
  { key: "included", label: "Included – $0" },
  { key: "review", label: "No contract price – review" },
  { key: "not_comparable", label: "Not comparable" },
  { key: "below", label: "Below list – check if discount/staged billing" },
] as const;
export function invoiceBucket(f: Finding): typeof INVOICE_BUCKETS[number]["key"] {
  if (f.charged !== null && new Decimal(f.charged).isZero()) return "included";
  if (f.disposition === "staged") return "staged";
  if (f.disposition === "not_comparable") return "not_comparable";
  if (f.disposition === "no_contract") return "review";
  if (f.flagged) return "overcharged";
  if (f.overcharge !== null && new Decimal(f.overcharge).lt(0)) return "below";
  return "matches";
}
export function invoiceSummary(findings: Finding[]) {
  const buckets = INVOICE_BUCKETS.map((bucket) => {
    const items = findings.filter((f) => f.kind === "invoice" && invoiceBucket(f) === bucket.key);
    return { ...bucket, items, count: items.length, total: items.reduce((sum, f) => sum.plus(f.charged ?? 0), new Decimal(0)).toFixed(2) };
  });
  const overcharged = buckets.find((b) => b.key === "overcharged");
  const overcharge_total = (overcharged?.items ?? []).reduce((sum, f) => sum.plus(f.overcharge ?? 0), new Decimal(0)).toFixed(2);
  return { buckets, overcharge_count: overcharged?.count ?? 0, overcharge_total };
}
export const REVIEW_DRAFT_VERSION = 1001;
export function invoiceReviewDraft(findings: Finding[], recipient: string, currency: string | null): string {
  const review = findings.filter((f) => f.kind === "invoice" && invoiceBucket(f) === "review");
  if (!review.length) throw new Error("No review items to draft.");
  const items = review.map((f) => `${f.invoice_item ?? f.item ?? "Invoice item"} (order ${f.order_no ?? "not provided"}, ${formatCurrency(f.charged, currency)})`).join("; ");
  const text = `Subject: Invoice items – contract price clarification\n\nDear ${recipient} Billing Team,\n\nPlease clarify the contract prices and billing basis for these invoice items: ${items}. I could not find matching entries in the supplied price list. Please confirm whether these charges are covered by our contract or need correcting.\n\nRegards,`;
  assertExactNumbers(text, [recipient, ...review.flatMap((f) => [f.invoice_item ?? f.item, f.order_no, formatCurrency(f.charged, currency)])]);
  return text;
}