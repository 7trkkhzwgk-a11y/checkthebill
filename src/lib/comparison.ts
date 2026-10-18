import Decimal from "decimal.js";
import { z } from "zod";
import { toDate } from "@/lib/extraction";

export const reviewedLineSchema = z.object({
  id: z.string().uuid(), date: z.string().nullable(), description: z.string().max(2000).nullable(),
  amount: z.number().finite().nonnegative().nullable(), type: z.enum(["charge", "credit"]),
  reference_no: z.string().max(500).nullable(), bank_ref: z.string().max(500).nullable(),
});
export const reviewedPromiseSchema = z.object({
  id: z.string().uuid(), promised_on: z.string().nullable(), item: z.string().max(2000).nullable(),
  original_charge: z.number().finite().nonnegative().nullable(), promised_amount: z.number().finite().nonnegative().nullable(),
  reference_no: z.string().max(500).nullable(), transaction_id: z.string().max(500).nullable(),
  bank_ref: z.string().max(500).nullable(), status_text: z.string().max(2000).nullable(), source: z.string().max(2000).nullable(),
});
export type ReviewedLine = z.infer<typeof reviewedLineSchema>;
export type ReviewedPromise = z.infer<typeof reviewedPromiseSchema> & { promise_kind?: string | null };
export type Finding = {
  kind: "refund" | "invoice"; promise_id: string; line_id: string | null;
  charged: string | null; promised: string | null; kept_by_merchant: string | null;
  credit_expected: string | null; credit_found: string | null; overcharge: string | null;
  promised_on: string | null; days_waiting: number | null;
  refund_id: string | null; transaction_id: string | null; bank_ref: string | null;
  flagged: boolean; flag_reason: string | null; recipient: "MERCHANT" | "BANK" | "VENDOR" | null;
  contact_reason: string | null; issue: string | null;
};
export type Comparison = { checked_on: string; findings: Finding[]; issues: string[]; status: "flagged" | "clear" | "incomplete" };
export const money = (value: number | string) => new Decimal(value).toFixed(2);
const equalMoney = (a: number | null, b: number | null) => a !== null && b !== null && new Decimal(a).eq(b);
const equalRef = (a: string | null, b: string | null) => !!a?.trim() && !!b?.trim() && a.trim() === b.trim();
const itemKey = (item: string | null) => item?.trim().replace(/\s+/g, " ").toLocaleLowerCase() ?? "";

// Invoked only at the authenticated server confirmation boundary; AI never computes these values.
export function compareConfirmed(lines: ReviewedLine[], promises: ReviewedPromise[], today: string): Comparison {
  if (!toDate(today)) throw new Error("Invalid comparison date.");
  const findings: Finding[] = [];
  const issues: string[] = [];
  const usedCredits = new Set<string>();
  const refunds = promises.filter((p) => p.promise_kind === "refund" || (!p.promise_kind && (p.original_charge !== null || !!p.transaction_id || /refund/i.test(p.source ?? ""))));
  const agreed = promises.filter((p) => !refunds.includes(p));
  const base = (p: ReviewedPromise, kind: Finding["kind"]): Finding => ({
    kind, promise_id: p.id, line_id: null, charged: null, promised: p.promised_amount === null ? null : money(p.promised_amount),
    kept_by_merchant: null, credit_expected: null, credit_found: null, overcharge: null,
    promised_on: toDate(p.promised_on), days_waiting: p.promised_on && toDate(p.promised_on) ? Math.floor((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${p.promised_on}T00:00:00Z`)) / 86400000) : null,
    refund_id: p.reference_no, transaction_id: p.transaction_id, bank_ref: p.bank_ref ?? "",
    flagged: false, flag_reason: null, recipient: null, contact_reason: null, issue: null,
  });
  for (const p of refunds) {
    const f = base(p, "refund");
    const charges = lines.filter((l) => l.type === "charge");
    const byRef = charges.filter((l) => equalRef(l.reference_no, p.transaction_id));
    const candidates = byRef.length ? byRef : charges.filter((l) => equalMoney(l.amount, p.original_charge));
    const charge = candidates.length === 1 ? candidates[0] : undefined;
    f.charged = p.original_charge === null ? null : money(p.original_charge);
    f.credit_expected = f.promised;
    f.kept_by_merchant = p.original_charge === null || p.promised_amount === null ? null : new Decimal(p.original_charge).minus(p.promised_amount).toFixed(2);
    const credits = lines.filter((l) => l.type === "credit" && !usedCredits.has(l.id));
    const byRefund = credits.filter((l) => equalRef(l.reference_no, p.reference_no));
    const creditCandidates = byRefund.length ? byRefund : credits.filter((l) => equalMoney(l.amount, p.promised_amount));
    const credit = creditCandidates.length === 1 ? creditCandidates[0] : undefined;
    f.credit_found = credit?.amount === null ? null : money(credit?.amount ?? 0);
    if (credit) usedCredits.add(credit.id);
    f.line_id = charge?.id ?? null;
    if (!charge || charge.amount === null || p.original_charge === null || p.promised_amount === null || creditCandidates.length > 1 || (credit && credit.amount === null)) {
      f.issue = candidates.length > 1 || creditCandidates.length > 1 ? "More than one transaction matches this refund. Review the references before deciding." : "This refund needs a matching charge and complete amounts before it can be checked.";
      issues.push(f.issue);
    } else if (new Decimal(f.credit_found ?? 0).lt(p.promised_amount)) {
      f.flagged = true;
      f.flag_reason = `Refund promised: ${f.promised}. Credit found: ${f.credit_found}. ${new Decimal(p.promised_amount).minus(f.credit_found ?? 0).toFixed(2)} is still missing.`;
      f.recipient = p.bank_ref?.trim() ? "BANK" : "MERCHANT";
      f.contact_reason = f.recipient === "BANK" ? "Contact the BANK because the refund is missing or incomplete and a bank reference is available." : "Contact the MERCHANT first because the refund is missing or incomplete and no bank reference was provided; ask for the bank reference number for the refund ID.";
    }
    findings.push(f);
  }
  if (agreed.length) {
    for (const line of lines.filter((l) => l.type === "charge")) {
      const matches = agreed.filter((p) => !!itemKey(p.item) && itemKey(p.item) === itemKey(line.description));
      const p = matches.length === 1 ? matches[0] : undefined;
      if (!p) { issues.push(matches.length ? "Multiple agreed prices match an invoice item. Review the promise." : `No agreed price matches invoice line ${line.id}.`); continue; }
      const f = base(p, "invoice");
      f.line_id = line.id;
      f.charged = line.amount === null ? null : money(line.amount);
      if (line.amount === null || p.promised_amount === null) { f.issue = "An invoice amount or agreed price is missing."; issues.push(f.issue); }
      else {
        f.overcharge = new Decimal(line.amount).minus(p.promised_amount).toFixed(2);
        if (new Decimal(f.overcharge).gt(0)) {
          f.flagged = true; f.recipient = "VENDOR";
          f.flag_reason = `Charged ${f.charged} instead of the agreed ${f.promised}; overcharge ${f.overcharge}.`;
          f.contact_reason = "Contact the VENDOR because this invoice line is above its agreed price.";
        }
      }
      findings.push(f);
    }
  }
  if (!promises.length || !lines.some((l) => l.type === "charge") || !findings.length) issues.push("There is not enough matching bill and promise information to finish this check.");
  return { checked_on: today, findings, issues: [...new Set(issues)], status: findings.some((f) => f.flagged) ? "flagged" : issues.length ? "incomplete" : "clear" };
}

export function countWordsChanged(draft: string, final: string): number {
  const before = draft.trim().split(/\s+/).filter(Boolean);
  const after = final.trim().split(/\s+/).filter(Boolean);
  let prev = Array.from({ length: after.length + 1 }, (_, i) => i);
  for (let i = 1; i <= before.length; i++) {
    const row = [i];
    for (let j = 1; j <= after.length; j++) row[j] = Math.min((row[j - 1] ?? 0) + 1, (prev[j] ?? 0) + 1, (prev[j - 1] ?? 0) + (before[i - 1] === after[j - 1] ? 0 : 1));
    prev = row;
  }
  return prev[after.length] ?? 0;
}

export function draftFacts(f: Finding) {
  return { recipient: f.recipient, charged: f.charged, refund_promised: f.kind === "refund" ? f.promised : null,
    agreed_price: f.kind === "invoice" ? f.promised : null, kept_by_merchant: f.kept_by_merchant,
    credit_expected: f.credit_expected, credit_found: f.credit_found, overcharge: f.overcharge,
    promised_on: f.promised_on, days_waiting: f.days_waiting, refund_id: f.refund_id, transaction_id: f.transaction_id,
    bank_ref: f.bank_ref, request: f.recipient === "MERCHANT" ? "Please provide the bank reference number for this refund ID." : f.recipient === "BANK" ? "Please trace the missing or incomplete refund using this bank reference." : "Please correct this invoice overcharge." };
}