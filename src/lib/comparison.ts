import Decimal from "decimal.js";
import { z } from "zod";
import { toDate } from "@/lib/extraction";
import { messageRequest } from "@/lib/message-format";
import { priceListItemName } from "@/lib/dandy";

export const reviewedLineSchema = z.object({
  id: z.string().uuid(), date: z.string().nullable(), description: z.string().max(2000).nullable(),
  amount: z.number().finite().nonnegative().nullable(), type: z.enum(["charge", "credit"]),
  reference_no: z.string().max(500).nullable(), bank_ref: z.string().max(500).nullable(),
  order_no: z.string().max(500).nullable().optional(),
  tax_amount: z.number().finite().nonnegative().nullable().optional(),
  total_amount: z.number().finite().nonnegative().nullable().optional(),
});
export const reviewedPromiseSchema = z.object({
  pnr: z.string().max(500).nullable().optional(),
  id: z.string().uuid(), promised_on: z.string().nullable(), item: z.string().max(2000).nullable(),
  original_charge: z.number().finite().nonnegative().nullable(), promised_amount: z.number().finite().nonnegative().nullable(),
  reference_no: z.string().max(500).nullable(), transaction_id: z.string().max(500).nullable(),
  bank_ref: z.string().max(500).nullable(), status_text: z.string().max(2000).nullable(), source: z.string().max(2000).nullable(),
  notes: z.string().max(2000).nullable().optional(),
});
export type ReviewedLine = z.infer<typeof reviewedLineSchema>;
export type ReviewedPromise = z.infer<typeof reviewedPromiseSchema> & { promise_kind?: string | null };
export type Finding = {
  order_no?: string | null; invoice_item?: string | null; disposition?: "matched" | "included" | "not_comparable" | "no_contract" | "staged";
  currency?: string | null; contact_name?: string | null; item?: string | null; pnr?: string | null; missing_amount?: string | null;
  kind: "refund" | "invoice"; promise_id: string; line_id: string | null;
  charged: string | null; promised: string | null; kept_by_merchant: string | null;
  credit_expected: string | null; credit_found: string | null; overcharge: string | null;
  promised_on: string | null; days_waiting: number | null;
  refund_id: string | null; transaction_id: string | null; bank_ref: string | null;
  flagged: boolean; flag_reason: string | null; note: string | null; recipient: "MERCHANT" | "BANK" | "VENDOR" | null;
  contact_reason: string | null; issue: string | null;
};
export type Reconciliation = { items_total: string; orders_subtotal: string | null; matches: boolean | null; tax_total?: string; tax_matches?: boolean | null; credits_total?: string; credits_matches?: boolean | null; total?: string; total_matches?: boolean | null; tax_conflicts?: string[] };
export type Comparison = { checked_on: string; findings: Finding[]; issues: string[]; status: "flagged" | "clear" | "incomplete"; reconciliation?: Reconciliation };
export const money = (value: number | string) => new Decimal(value).toFixed(2);
const equalMoney = (a: number | null, b: number | null) => a !== null && b !== null && new Decimal(a).eq(b);
const equalRef = (a: string | null, b: string | null) => !!a?.trim() && !!b?.trim() && a.trim() === b.trim();
const itemKey = (item: string | null) => item?.trim().replace(/\s+/g, " ").toLocaleLowerCase() ?? "";
export function invoiceItemName(description: string | null): string {
  return (description ?? "").replace(/^\s*crown\s+(?:\d+|n)\s*[-–—]\s*/i, "").trim();
}
export function reconcileInvoice(lines: { amount: number | null; type: string | null; order_no?: string | null | undefined; reference_no?: string | null | undefined; tax_amount?: number | null | undefined }[], ordersSubtotal: number | null, totals?: { sales_tax?: number | null; bill_total?: number | null }): Reconciliation {
  const items_total = lines.filter((l) => l.type === "charge").reduce((sum, l) => sum.plus(l.amount ?? 0), new Decimal(0)).toFixed(2);
  const result: Reconciliation = { items_total, orders_subtotal: ordersSubtotal === null ? null : money(ordersSubtotal), matches: ordersSubtotal === null || lines.some((l) => l.type === "charge" && l.amount === null) ? null : new Decimal(items_total).eq(ordersSubtotal) };
  if (!totals) return result;
  const orders = new Map<string, number | null>();
  const conflicts = new Set<string>();
  let missingOrder = false;
  for (const line of lines.filter((l) => l.type === "charge")) {
    const order = line.order_no?.trim() || line.reference_no?.trim();
    if (!order) { missingOrder = true; continue; }
    const previous = orders.get(order);
    if (previous != null && line.tax_amount != null && !new Decimal(previous).eq(line.tax_amount)) conflicts.add(order);
    if (!orders.has(order) || previous == null) orders.set(order, line.tax_amount ?? null);
  }
  const tax = [...orders.values()].reduce<Decimal>((sum, value) => sum.plus(value ?? 0), new Decimal(0));
  const credits = lines.filter((l) => l.type === "credit").reduce((sum, l) => sum.plus(l.amount ?? 0), new Decimal(0));
  const incomplete = lines.some((l) => l.amount === null);
  const taxIncomplete = missingOrder || [...orders.values()].some((v) => v === null) || conflicts.size > 0;
  const total = new Decimal(items_total).plus(tax).minus(credits);
  return { ...result, tax_total: tax.toFixed(2), tax_matches: totals.sales_tax == null || taxIncomplete ? null : tax.eq(totals.sales_tax), credits_total: credits.toFixed(2),
    credits_matches: incomplete || ordersSubtotal == null || totals.sales_tax == null || totals.bill_total == null ? null : new Decimal(ordersSubtotal).plus(totals.sales_tax).minus(totals.bill_total).eq(credits),
    total: total.toFixed(2), total_matches: incomplete || taxIncomplete || totals.bill_total == null ? null : total.eq(totals.bill_total), tax_conflicts: [...conflicts] };
}

// A price-list row is comparable only when it carries one fixed agreed price.
export function isComparablePromise(p: Pick<ReviewedPromise, "item" | "promised_amount" | "notes">): boolean {
  const text = `${p.item ?? ""} ${p.notes ?? ""}`;
  if (p.promised_amount === null) return false;
  if (/\+\s*alloy|\bn\/?a\b/i.test(text)) return false;
  if (/\d[\d,.]*\s*(?:-|–|—|to)\s*\d[\d,.]*/.test(text)) return false;
  return true;
}

// Staged items (partial dentures or rows marked staged) bill across orders; they are never flagged.
export function isStagedItem(p: Pick<ReviewedPromise, "item" | "notes">): boolean {
  return /\bpartial\b|\bstaged\b/i.test(`${p.item ?? ""} ${p.notes ?? ""}`);
}

const STOPWORDS = new Set(["the", "a", "an", "of", "for", "and", "with", "per", "item", "each", "tooth", "teeth", "no", "type"]);
const tokens = (text: string | null) => (text ?? "").toLocaleLowerCase().replace(/\(\s*x\s*\d+\s*\)/g, " ").split(/[^a-z0-9]+/).filter((t) => t && !STOPWORDS.has(t));

// "(x2)" / "x2" marks quantity; teeth on both sides of the arch midline mean bilateral (quantity 2 for unilateral prices).
export function lineQuantity(description: string | null): number {
  const text = description ?? "";
  const explicit = text.match(/\(\s*x\s*(\d+)\s*\)|\bx\s*(\d+)\b/i);
  if (explicit) return Math.max(1, Number(explicit[1] ?? explicit[2]));
  if (isBilateral(text) && !/bilateral|both\s+sides|full\s+arch/i.test(text)) return 2;
  return 1;
}
// FDI/universal tooth numbers on both left (2x, 3x or 17-32) and right (1x, 4x or 1-16) of the midline.
export function isBilateral(description: string | null): boolean {
  const text = (description ?? "").toLocaleLowerCase();
  if (/bilateral|both\s+sides/.test(text)) return true;
  const numbers = (text.match(/\b(?:[1-4][1-8]|[1-9]|[12]\d|3[0-2])\b/g) ?? []).map(Number).filter((n) => (n >= 11 && n <= 48) || (n >= 1 && n <= 32));
  const side = (n: number) => (n >= 11 && n <= 48 ? (n >= 11 && n <= 18) || (n >= 41 && n <= 48) : n <= 16);
  return numbers.some((n) => side(n)) && numbers.some((n) => !side(n));
}

export type ItemMatch = { line_id: string; promise_id: string | null; confidence: number; quantity: number; disposition: "matched" | "included" | "not_comparable" | "no_contract" | "staged" };
export function groupInvoiceMatches(lines: Pick<ReviewedLine, "id" | "description">[], matches: ItemMatch[]) {
  const groups = new Map<string, { name: string; line_ids: string[]; match: ItemMatch }>();
  for (const m of matches.filter((m) => m.disposition === "matched")) {
    const name = invoiceItemName(lines.find((l) => l.id === m.line_id)?.description ?? null);
    const key = itemKey(name);
    const group = groups.get(key);
    if (group) group.line_ids.push(m.line_id);
    else groups.set(key, { name, line_ids: [m.line_id], match: m });
  }
  return [...groups.values()];
}
export function applyGroupMatch(overrides: Record<string, string>, lineIds: string[], promiseId: string): Record<string, string> {
  return { ...overrides, ...Object.fromEntries(lineIds.map((id) => [id, promiseId])) };
}
export const MATCH_CONFIDENCE_THRESHOLD = 0.5;

export function closestPriceListNames(description: string | null, promises: Pick<ReviewedPromise, "item" | "notes">[]): string[] {
  const wanted = tokens(invoiceItemName(description));
  const ranked = promises.filter((p) => p.item).map((p) => {
    const words = tokens(priceListItemName(p));
    const overlap = wanted.filter((word) => words.some((w) => w === word || w.startsWith(word) || word.startsWith(w))).length;
    return { name: p.item ?? "", score: wanted.length + words.length ? 2 * overlap / (wanted.length + words.length) : 0 };
  }).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return [...new Set(ranked.map((p) => p.name))].slice(0, 3);
}

// Aliases select saved contract rows, never invent prices when a contract row is absent.
const INVOICE_ITEM_ALIASES: Readonly<Record<string, string>> = {
  "signature denture bundle - wax rim workflow": "Signature New Dentures & Overdentures - Wax bite rim workflow",
  "signature denture - new denture, wax rim workflow": "Signature New Dentures & Overdentures - Wax bite rim workflow",
  "signature denture - new denture, reference workflow": "Signature New Dentures & Overdentures - Reference workflow",
  "monolithic try-in": "Monolithic Try-in (per arch)",
  "zirconia monolithic": "Zirconia Monolithic",
  "model - dual full arch": "Model: Dual Full Arch Articulated",
};
const aliasKey = (text: string | null) => itemKey(invoiceItemName(text)
  .replace(/\(\s*x\s*\d+\s*\)|\bx\s*\d+\b/gi, " ").replace(/[–—]/g, "-"));

// Exact aliases precede keyword overlap; best unique fuzzy score wins for other items.
export function matchInvoiceItems(lines: (Pick<ReviewedLine, "id" | "description" | "type"> & { amount?: number | null })[], promises: ReviewedPromise[]): ItemMatch[] {
  const candidates = promises.filter((p) => !!itemKey(p.item));
  return lines.filter((l) => l.type === "charge").map((line) => {
    const quantity = lineQuantity(line.description);
    if (line.amount === 0) return { line_id: line.id, promise_id: null, confidence: 1, quantity, disposition: "included" };
    const staged = isStagedItem({ item: line.description, notes: null });
    const alias = INVOICE_ITEM_ALIASES[aliasKey(line.description)];
    if (alias) {
      const exact = candidates.filter((p) => {
        const leaf = aliasKey(priceListItemName(p));
        if (/^Signature New Dentures/.test(alias)) {
          const workflow = /Wax bite rim/i.test(alias) ? "wax bite rim" : "reference";
          return leaf === aliasKey(alias) || (/Full Dentures [—–-] Signature dentures/i.test(p.item ?? "") && leaf === aliasKey(`New Dentures & Overdentures – ${workflow} workflow`));
        }
        if (alias === "Zirconia Monolithic" && p.notes?.startsWith("Section:") && !/^Section: Crown & Bridge/i.test(p.notes)) return false;
        return leaf === aliasKey(alias);
      });
      const p = exact.length === 1 ? exact[0] : undefined;
      return { line_id: line.id, promise_id: p?.id ?? null, confidence: p ? 1 : 0, quantity,
        disposition: p ? isStagedItem(p) ? "staged" : isComparablePromise(p) ? "matched" : "not_comparable" : "no_contract" };
    }
    const lineTokens = tokens(invoiceItemName(line.description));
    const bilateral = isBilateral(line.description);
    let best: ReviewedPromise | null = null;
    let bestScore = 0;
    let tied = false;
    for (const p of candidates) {
      const promiseTokens = tokens(priceListItemName(p));
      if (lineTokens.includes("additional") && !promiseTokens.includes("additional")) continue;
      const overlap = lineTokens.filter((t) => promiseTokens.some((pt) => pt === t || pt.startsWith(t) || t.startsWith(pt))).length;
      let score = lineTokens.length ? overlap / lineTokens.length : 0;
      if (/bilateral|unilateral/i.test(p.item ?? "")) {
        const promiseBilateral = /bilateral|full\s+arch/i.test(p.item ?? "");
        score += promiseBilateral === bilateral ? 0.15 : -0.15;
      }
      score = Math.min(1, Math.max(0, score));
      if (score > bestScore + 1e-9) { best = p; bestScore = score; tied = false; }
      else if (Math.abs(score - bestScore) <= 1e-9 && score > 0) tied = true;
    }
    if (tied || bestScore < MATCH_CONFIDENCE_THRESHOLD) return { line_id: line.id, promise_id: null, confidence: staged ? 1 : Math.round(bestScore * 100) / 100, quantity, disposition: staged ? "staged" : "no_contract" };
    return { line_id: line.id, promise_id: best?.id ?? null, confidence: staged ? 1 : Math.round(bestScore * 100) / 100, quantity, disposition: staged || (best && isStagedItem(best)) ? "staged" : best && isComparablePromise(best) ? "matched" : "not_comparable" };
  });
}

// Invoked only at the authenticated server confirmation boundary; AI never computes these values.
export function compareConfirmed(lines: ReviewedLine[], promises: ReviewedPromise[], today: string, options?: { orders_subtotal?: number | null; sales_tax?: number | null; bill_total?: number | null; confirmed_matches?: Record<string, string> }): Comparison {
  const billTotals = { orders_subtotal: options?.orders_subtotal ?? null, sales_tax: options?.sales_tax ?? null };
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
    refund_id: p.reference_no, transaction_id: p.transaction_id, bank_ref: p.bank_ref ?? "", pnr: p.pnr ?? null, item: p.item,
    flagged: false, flag_reason: null, note: null, recipient: null, contact_reason: null, issue: null,
  });
  const chargeLines = lines.filter((l) => l.type === "charge");
  if (billTotals?.orders_subtotal != null) {
    const itemSum = chargeLines.reduce((sum, l) => sum.plus(l.amount ?? 0), new Decimal(0));
    if (chargeLines.length && !itemSum.eq(new Decimal(billTotals.orders_subtotal))) {
      issues.push(`The pre-tax item prices add up to ${itemSum.toFixed(2)}, but the invoice Orders subtotal is ${money(billTotals.orders_subtotal)}. Check the lines before trusting this comparison.`);
    }
  }
  if (billTotals?.sales_tax != null) {
    const taxCheck = reconcileInvoice(lines, billTotals.orders_subtotal, options);
    if (taxCheck.tax_matches === false) {
      issues.push(`The order-level sales tax adds up to ${taxCheck.tax_total}, but the invoice Sales Tax total is ${money(billTotals.sales_tax)}. Check the tax amounts.`);
    }
    if (taxCheck.tax_conflicts?.length) issues.push(`Conflicting tax amounts for order ${taxCheck.tax_conflicts.join(", ")}. Check the tax amounts.`);
  }
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
    f.missing_amount = f.promised === null || f.credit_found === null ? null : new Decimal(f.promised).minus(f.credit_found).toFixed(2);
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
  if (agreed.length || (!refunds.length && options?.orders_subtotal != null)) {
    const matches = matchInvoiceItems(lines, agreed);
    for (const line of lines.filter((l) => l.type === "charge")) {
      const match = matches.find((m) => m.line_id === line.id);
      const override = options?.confirmed_matches?.[line.id];
      const chosenId = match?.disposition === "included" ? null : override ?? match?.promise_id ?? null;
      const p = chosenId ? agreed.find((candidate) => candidate.id === chosenId) : undefined;
      const f = base(p ?? { id: "", item: line.description, promised_amount: null, original_charge: null, promised_on: null, reference_no: null, transaction_id: null, bank_ref: null, status_text: null, source: null }, "invoice");
      f.line_id = line.id;
      f.order_no = line.order_no ?? line.reference_no;
      f.invoice_item = line.description;
      f.disposition = match?.disposition === "included" ? "included" : p ? isComparablePromise(p) ? "matched" : "not_comparable" : "no_contract";
      f.charged = line.amount === null ? null : money(line.amount);
      if (f.disposition !== "included" && (isStagedItem({ item: line.description, notes: null }) || (p && isStagedItem(p)))) {
        f.disposition = "staged";
        f.promised = null;
        f.overcharge = null;
        f.note = "Staged – check total when order completes.";
        findings.push(f);
        continue;
      }
      if (f.disposition !== "matched" || !p) {
        f.promised = null;
        f.note = f.disposition === "included" ? "Included – $0" : f.disposition === "not_comparable" ? "Not comparable" : "No contract price – review";
        if (f.disposition === "no_contract") issues.push(`No contract price – review: ${line.description ?? "Invoice item"}.`);
        findings.push(f);
        continue;
      }
      if (line.amount === null || p.promised_amount === null) { f.issue = "An invoice amount or agreed price is missing."; issues.push(f.issue); }
      else {
        const agreedTotal = new Decimal(p.promised_amount).times(match?.quantity ?? 1);
        f.promised = agreedTotal.toFixed(2);
        f.overcharge = new Decimal(line.amount).minus(agreedTotal).toFixed(2);
        if (isStagedItem(p) || isStagedItem({ item: line.description, notes: null })) {
          f.note = "Staged – check total when order completes.";
        } else if (new Decimal(f.overcharge).gt(0)) {
          f.flagged = true; f.recipient = "VENDOR";
          f.flag_reason = `Charged ${f.charged} instead of the agreed ${f.promised}; overcharge ${f.overcharge}.`;
          f.contact_reason = "Contact the VENDOR because this invoice line is above its agreed price.";
        } else if (new Decimal(f.overcharge).lt(0)) {
          f.note = "Below list price – check if this is a discount or staged billing.";
        }
      }
      findings.push(f);
    }
  }
  if (!promises.length || !lines.some((l) => l.type === "charge") || !findings.length) issues.push("There is not enough matching bill and promise information to finish this check.");
  return { checked_on: today, findings, issues: [...new Set(issues)], status: findings.some((f) => f.flagged) ? "flagged" : issues.length ? "incomplete" : "clear", ...(!refunds.length ? { reconciliation: reconcileInvoice(lines, billTotals.orders_subtotal, options) } : {}) };
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
  return { recipient: f.contact_name ?? (f.recipient === "BANK" ? "your bank" : f.kind === "refund" ? "the merchant" : "the billing company"), item: f.kind === "invoice" ? f.invoice_item ?? f.item : f.item, pnr: f.pnr,
    ...(f.kind === "invoice" ? { order_no: f.order_no ?? null } : {}),
    refund_promised: f.kind === "refund" ? f.promised : null,
    agreed_price: f.kind === "invoice" ? f.promised : null,
    credit_found: f.credit_found, missing_amount: f.missing_amount, overcharge: f.overcharge,
    promised_on: f.promised_on, days_waiting: f.days_waiting, refund_id: f.refund_id, transaction_id: f.transaction_id,
    bank_ref: f.bank_ref, request: messageRequest(f) };
}