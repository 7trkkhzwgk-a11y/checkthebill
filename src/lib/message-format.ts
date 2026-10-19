import Decimal from "decimal.js";
import type { Finding, ReviewedPromise } from "@/lib/comparison";

export const DRAFT_VERSION = 3;
export function currencyCode(value: string | null | undefined): string | null {
  const code = value?.trim().toUpperCase();
  return code && /^[A-Z]{3}$/.test(code) ? code : null;
}
export function formatCurrency(value: string | number | null | undefined, currency?: string | null): string {
  if (value == null) return "—";
  const fixed = new Decimal(value).toFixed(2);
  const [whole = "0", fraction = "00"] = fixed.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const code = currencyCode(currency);
  const symbol = code ? new Intl.NumberFormat("en-US", { style: "currency", currency: code, currencyDisplay: "narrowSymbol" }).formatToParts(0).find((p) => p.type === "currency")?.value ?? code : "";
  return `${symbol}${grouped}.${fraction}`;
}
const actualName = (value: string | null | undefined) => {
  const name = value?.replace(/\s+(?:(?:cancellation\s*\/\s*)?refund\s+confirmation|contract|price list|invoice|statement)$/i, "").trim();
  return name && !/^(?:refund(?: confirmation)?|contract|price list|promise|bill|invoice|merchant|bank|vendor)$/i.test(name) ? name : null;
};
export function presentFinding(f: Finding, promise: Partial<ReviewedPromise> | undefined, issuer: string | null, currency: string | null): Finding {
  const source = actualName(promise?.source);
  const billIssuer = actualName(issuer);
  // Rehydrate routing from saved promise facts, never from the bill's display name.
  const bank_ref = f.kind === "refund" ? promise?.bank_ref ?? f.bank_ref : f.bank_ref;
  const recipient = f.kind === "refund" && f.flagged ? bank_ref?.trim() ? "BANK" : "MERCHANT" : f.recipient;
  const contact_name = f.kind === "invoice" || recipient === "BANK" ? billIssuer : source;
  const name = contact_name ?? (recipient === "BANK" ? "your bank" : f.kind === "refund" ? "the merchant" : "the billing company");
  const pnr = promise?.pnr ?? f.pnr ?? promise?.item?.match(/\bPNR(?:\s*(?:no\.?|number|id))?\s*[:#-]?\s*([A-Z0-9-]+)/i)?.[1] ?? null;
  const detectedCurrency = currencyCode(currency) ?? f.currency ?? (/\bIRCTC\b/i.test(source ?? "") ? "INR" : null);
  const missing_amount = f.missing_amount ?? (f.kind === "refund" && f.promised !== null && f.credit_found !== null ? new Decimal(f.promised).minus(f.credit_found).toFixed(2) : null);
  const result = { ...f, recipient, bank_ref, currency: detectedCurrency, contact_name, item: promise?.item ?? f.item ?? null, pnr, missing_amount };
  const amount = (v: string | null) => formatCurrency(v, detectedCurrency);
  result.flag_reason = !f.flagged ? null : f.kind === "refund"
    ? `Refund promised: ${amount(f.promised)}. Credit found: ${amount(f.credit_found)}. ${amount(f.missing_amount ?? new Decimal(f.promised ?? 0).minus(f.credit_found ?? 0).toFixed(2))} is still missing.`
    : `Charged ${amount(f.charged)} instead of the agreed ${amount(f.promised)}; overcharge ${amount(f.overcharge)}.`;
  result.contact_reason = !recipient ? null : recipient === "MERCHANT"
    ? `Contact ${name} first because no bank reference was provided. Ask for the bank reference number for this refund ID.`
    : recipient === "BANK" ? `Contact ${name} to trace and credit the missing refund using the available bank reference.`
    : `Contact ${name} because this invoice line is above its agreed price.`;
  return result;
}

export function messageRequest(f: Finding): string {
  if (f.kind === "invoice") return "Please correct this invoice overcharge.";
  return f.bank_ref?.trim()
    ? `Please trace and credit ${formatCurrency(f.missing_amount, f.currency)} using bank reference ${f.bank_ref.trim()}.`
    : `Please provide the bank reference number for refund ID ${f.refund_id ?? "not provided"}.`;
}

export function assertMessageRouting(text: string, f: Finding): void {
  const request = messageRequest(f);
  const merchantAsk = /(?:provide|send|share|supply|give|request)\b[^.!?\n]*\bbank reference/i;
  const bankAsk = /\btrace\b|\bcredit\b[^.!?\n]*\busing\b/i;
  const remainder = text.replace(request, "");
  if (!text.includes(request) || remainder.includes(request) || (remainder.match(/\bDear\b/g) ?? []).length !== 1 ||
    (f.kind === "refund" && (merchantAsk.test(remainder) || bankAsk.test(remainder)))) {
    throw new Error("The message did not preserve the contact request. Your confirmed maths has been saved.");
  }
}

// Remove only complete, exact fact tokens before checking for invented or altered numbers.
export function assertExactNumbers(text: string, tokens: (string | number | null | undefined)[]) {
  let remaining = text;
  const values = [...new Set(tokens.filter((v): v is string | number => v != null && v !== "").map(String))].sort((a, b) => b.length - a.length);
  for (const value of values) {
    const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    remaining = remaining.replace(new RegExp(`(?<![\\p{L}\\p{N}.,])${escaped}(?![\\p{L}\\p{N}.,]\\d|[\\p{L}\\p{N}])`, "gu"), " FACT ");
  }
  if (/\d/.test(remaining)) throw new Error("The message changed a number. Your confirmed maths has been saved.");
}

// Chat answers guard only money amounts; day counts, dates, IDs and question numbers are allowed.
const MONEY_TOKEN = /[₹$€£]\s?\d[\d,]*(?:\.\d+)?|\b\d[\d,]*\.\d{2}\b/g;
const normalizeMoney = (token: string) => new Decimal(token.replace(/[₹$€£,\s]/g, "")).toFixed(2);
export function assertChatMoney(text: string, allowed: (string | number | null | undefined)[], question: string) {
  const allowedValues = new Set(
    allowed
      .filter((v): v is string | number => v != null && v !== "")
      .map((v) => normalizeMoney(String(v))),
  );
  // Numbers the user stated in their own question are allowed through.
  for (const match of question.match(MONEY_TOKEN) ?? []) allowedValues.add(normalizeMoney(match));
  for (const match of text.match(MONEY_TOKEN) ?? []) {
    if (!allowedValues.has(normalizeMoney(match))) throw new Error("I couldn't answer that safely — please rephrase.");
  }
}