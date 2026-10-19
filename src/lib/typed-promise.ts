import Decimal from "decimal.js";
import { z } from "zod";
import type { Comparison, Finding, ReviewedLine, ReviewedPromise } from "@/lib/comparison";
import { formatCurrency } from "@/lib/message-format";

export const typedDetailsSchema = z.object({
  kind: z.enum(["refund", "price"]),
  tax_inclusive: z.boolean().nullable(),
  taxes: z.array(z.object({ label: z.string().max(100), rate: z.number().finite().min(0).max(100), taxable_amount: z.number().finite().nonnegative().nullable() })).max(10),
  line_id: z.string().uuid().nullable().optional(),
});
export type TypedDetails = z.infer<typeof typedDetailsSchema>;
export type TaxCheck = { label: string; rate: number; taxable_amount: string; expected: string; billed: string | null; difference: string | null };

export function typedTaxMath(amount: number, details: TypedDetails) {
  const rates = details.taxes.reduce((sum, tax) => sum.plus(tax.rate), new Decimal(0));
  const base = details.tax_inclusive ? new Decimal(amount).div(new Decimal(1).plus(rates.div(100))) : new Decimal(amount);
  const taxes = details.taxes.map(tax => ({ ...tax, taxable_amount: new Decimal(tax.taxable_amount ?? base).toFixed(2), expected: new Decimal(tax.taxable_amount ?? base).times(tax.rate).div(100).toFixed(2) }));
  return { base: base.toFixed(2), total: details.tax_inclusive ? new Decimal(amount).toFixed(2) : base.plus(taxes.reduce((sum, tax) => sum.plus(tax.expected), new Decimal(0))).toFixed(2), taxes };
}

export function compareTypedPromises(lines: ReviewedLine[], promises: ReviewedPromise[], today: string): Comparison {
  const findings: Finding[] = [];
  const issues: string[] = [];
  const usedCredits = new Set<string>();
  for (const p of promises) {
    const details = typedDetailsSchema.parse(p.typed_details);
    const charges = lines.filter(l => l.type === "charge" && !/\b(?:tax|gst|cess)\b/i.test(l.description ?? ""));
    const words = (p.item ?? "").toLowerCase().split(/\W+/).filter(w => w.length > 2 && !["refund", "promised", "price", "agreed"].includes(w));
    const named = charges.filter(l => words.some(w => (l.description ?? "").toLowerCase().includes(w)));
    const referenced = charges.filter(l => p.transaction_id && l.reference_no === p.transaction_id);
    const candidates = details.line_id ? charges.filter(l => l.id === details.line_id) : referenced.length ? referenced : named.length ? named : charges;
    const line = candidates.length === 1 ? candidates[0] : undefined;
    const f: Finding = { kind: details.kind === "refund" ? "refund" : "invoice", typed_promise: true, promise_id: p.id, line_id: line?.id ?? null, item: p.item, invoice_item: line?.description ?? null, charged: line?.amount == null ? null : new Decimal(line.amount).toFixed(2), promised: p.promised_amount == null ? null : new Decimal(p.promised_amount).toFixed(2), kept_by_merchant: null, credit_expected: null, credit_found: null, overcharge: null, promised_on: p.promised_on, days_waiting: p.promised_on ? Math.floor((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${p.promised_on}T00:00:00Z`)) / 86400000) : null, refund_id: p.reference_no, transaction_id: p.transaction_id, bank_ref: p.bank_ref, flagged: false, flag_reason: null, note: "Promise you entered (no document)", recipient: null, contact_reason: null, issue: null };
    if (!line || line.amount == null || p.promised_amount == null) {
      f.issue = "Select the matching bill charge and enter the promised amount before comparing.";
      issues.push(f.issue);
    } else if (details.kind === "refund") {
      const credits = lines.filter(l => l.type === "credit" && !usedCredits.has(l.id) && (p.reference_no ? l.reference_no === p.reference_no : l.amount != null && new Decimal(l.amount).eq(p.promised_amount ?? 0)));
      f.credit_expected = f.promised;
      if (credits.length > 1) { f.issue = "More than one credit matches this verbal refund. Check the references."; issues.push(f.issue); }
      else {
        const credit = credits[0];
        if (credit) usedCredits.add(credit.id);
        f.credit_found = credit?.amount == null ? "0.00" : new Decimal(credit.amount).toFixed(2);
        f.missing_amount = new Decimal(p.promised_amount).minus(f.credit_found).toFixed(2);
        f.flagged = new Decimal(f.missing_amount).gt(0);
      }
    } else {
      const maths = typedTaxMath(p.promised_amount, details);
      if (details.taxes.length && details.tax_inclusive === null) { f.issue = "Confirm whether the promised price includes tax."; issues.push(f.issue); }
      f.promised = maths.total;
      f.tax_checks = maths.taxes.map(tax => {
        const gst = /gst/i.test(tax.label);
        const taxLines = lines.filter(l => l.type === "charge" && (gst ? /\b(?:[cis]?gst)\b/i.test(l.description ?? "") : (l.description ?? "").toLowerCase().includes(tax.label.toLowerCase())));
        const taxValue = taxLines.length && taxLines.every(l => l.amount != null) ? taxLines.reduce((sum, l) => sum.plus(l.amount ?? 0), new Decimal(0)) : details.taxes.length === 1 && line.tax_amount != null ? new Decimal(line.tax_amount) : null;
        const billed = taxValue?.toFixed(2) ?? null;
        return { label: tax.label, rate: tax.rate, taxable_amount: tax.taxable_amount, expected: tax.expected, billed, difference: billed == null ? null : new Decimal(billed).minus(tax.expected).toFixed(2) };
      });
      for (const tax of f.tax_checks) if (tax.billed == null) issues.push(`The billed ${tax.label} amount is missing; enter it on the matching bill line or check the separate tax transaction.`);
      const taxTotal = f.tax_checks.reduce((sum, tax) => sum.plus(tax.billed ?? 0), new Decimal(0));
      const charged = line.total_amount != null ? new Decimal(line.total_amount) : line.tax_amount != null || f.tax_checks.some(tax => tax.billed != null) ? new Decimal(line.amount).plus(taxTotal) : new Decimal(line.amount);
      f.charged = charged.toFixed(2);
      f.overcharge = charged.minus(maths.total).toFixed(2);
      f.flagged = !f.issue && (new Decimal(f.overcharge).gt(0) || f.tax_checks.some(tax => tax.difference != null && !new Decimal(tax.difference).isZero()));
    }
    if (f.flagged) { f.recipient = "VENDOR"; f.flag_reason = "The bill differs from the promise you entered. Ask the company to confirm."; }
    findings.push(f);
  }
  return { checked_on: today, findings, issues: [...new Set(issues)], status: findings.some(f => f.flagged) ? "flagged" : issues.length ? "incomplete" : "clear" };
}

export function typedPromiseDraft(f: Finding): string {
  const amount = (v: string | null | undefined) => formatCurrency(v, f.currency);
  const statement = f.kind === "refund" ? `I was informed that a refund of ${amount(f.promised)} was promised${f.promised_on ? ` on ${f.promised_on}` : ""}. The credit found is ${amount(f.credit_found)}, leaving ${amount(f.missing_amount)} missing.` : `I was informed that the agreed total for ${f.item ?? "this item"} was ${amount(f.promised)}. The billed total is ${amount(f.charged)}.`;
  const taxes = (f.tax_checks ?? []).filter(t => t.difference != null && !new Decimal(t.difference).isZero()).map(t => `${t.label}: expected ${amount(t.expected)}, billed ${amount(t.billed)}, difference ${amount(t.difference)}.`).join(" ");
  return `Subject: Please confirm the promise and billing\n\nDear ${f.contact_name ?? "the company"} Customer Care,\n\n${statement}${taxes ? ` ${taxes}` : ""} Please confirm what I was told and resolve this discrepancy.\n\nRegards,`;
}