import Decimal from "decimal.js";
import type { Finding, ReviewedPromise } from "@/lib/comparison";

export const DRAFT_VERSION = 2;
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
  const name = value?.trim();
  return name && !/^(?:refund(?: confirmation)?|contract|price list|promise|bill|invoice|merchant|bank|vendor)$/i.test(name) ? name : null;
};
export function presentFinding(f: Finding, promise: Partial<ReviewedPromise> | undefined, issuer: string | null, currency: string | null): Finding {
  const source = actualName(promise?.source);
  const billIssuer = actualName(issuer);
  const contact_name = f.recipient === "BANK" ? billIssuer : source ?? (f.recipient === "VENDOR" ? billIssuer : null);
  const name = contact_name ?? (f.recipient === "BANK" ? "your bank" : "the billing company");
  const pnr = promise?.pnr ?? f.pnr ?? promise?.item?.match(/\bPNR(?:\s*(?:no\.?|number|id))?\s*[:#-]?\s*([A-Z0-9-]+)/i)?.[1] ?? null;
  const detectedCurrency = currencyCode(currency) ?? f.currency ?? (/\bIRCTC\b/i.test(source ?? "") ? "INR" : null);
  const result = { ...f, currency: detectedCurrency, contact_name, item: promise?.item ?? f.item ?? null, pnr };
  const amount = (v: string | null) => formatCurrency(v, detectedCurrency);
  result.flag_reason = !f.flagged ? null : f.kind === "refund"
    ? `Refund promised: ${amount(f.promised)}. Credit found: ${amount(f.credit_found)}. ${amount(f.missing_amount ?? new Decimal(f.promised ?? 0).minus(f.credit_found ?? 0).toFixed(2))} is still missing.`
    : `Charged ${amount(f.charged)} instead of the agreed ${amount(f.promised)}; overcharge ${amount(f.overcharge)}.`;
  result.contact_reason = !f.recipient ? null : f.recipient === "MERCHANT"
    ? `Contact ${name} first because no bank reference was provided. Ask for the bank reference number for this refund ID.`
    : f.recipient === "BANK" ? `Contact ${name} to trace and credit the missing refund using the available bank reference.`
    : `Contact ${name} because this invoice line is above its agreed price.`;
  return result;
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