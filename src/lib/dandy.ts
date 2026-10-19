import type { Extraction } from "@/lib/extraction";

// Deterministic reader for Dandy lab invoices and Dandy price lists. Runs as code only:
// no AI call, no token spend. Everything here is pure text handling so it can be tested directly.

const DANDY_MARKERS = ["zimainternational", "meetdandy.com", "dandymasterpricinglist", "dandylab—masterpricinglist", "dandylab-masterpricinglist"];
const MONEY = /(-)?\s?\$\s?(\d[\d,]*(?:\.\d{1,2})?)/g;
const HEADER = /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+Order\s*#(\d{3}-\d{3}-\d{3})\b\s*(.*)$/i;
const NOISE = /^(?:PAGE \d+ OF \d+|Invoice|Invoice #.*\bdue\b.*|.*powered by dandy.*|.*dandy assumes.*|\* ?Credit amount is tax inclusive.*|Date Description Doctor Price Sales Tax Total)$/i;
const SQUASHED_NOISE = [/^invoice$/i, /^invoice#/i, /^page\d+of\d+$/i, /poweredbydandy/i, /dandyassumes/i, /^\*?creditamountistaxinclusive/i, /^datedescriptiondoctorpricesalestaxtotal$/i];
const SECTION_TITLES = /^(?:\d+\.\s|Materials$|Add-ons and modifications$|Final Implant Restorations\*?$|OEM component surcharge.*$|Plan expiration$|Refinement$|Retainers$|Extra Retainers$|Turnaround time.*$|Steps$|Description$|Plans$|Requirements$|Price$|Type$|Material$|Option$|Included$)/i;

const isShortWord = (word: string) => /^[a-z]{1,2}$/i.test(word) || /^[\W\d]{1,2}$/.test(word);

/** True when a fragment is a letter-spaced word ("R efe r ence") rather than a printed phrase ("1 per order"). */
function isSpacedFragment(words: string[]) {
  if (words.length < 2) return false;
  if (words.filter(isShortWord).length / words.length >= 0.6) return true;
  if (!/^[a-z]$/i.test(words[0] ?? "")) return false;
  const rest = words.slice(1);
  return rest.every((w) => w.length <= 4) && (rest.length >= 2 || (rest[0]?.length ?? 0) <= 3);
}
const squash = (text: string) => text.replace(/\s+/g, "");

/**
 * pdf.js emits letter-spaced text for these PDFs: one space inside a word, two or more between words.
 * Re-join those fragments so "Pa rt i a l   D en tur e" reads as "Partial Denture", while leaving
 * normally spaced text ("Zirconia Monolithic $75", "4, 5, and 13") exactly as printed.
 */
export function readLine(line: string) {
  return line
    .split(/\s{2,}/)
    .map((token) => {
      const words = token.split(" ");
      return isSpacedFragment(words) ? words.join("") : token;
    })
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

const isNoise = (line: string) => NOISE.test(line) || SQUASHED_NOISE.some((pattern) => pattern.test(squash(line)));

function moneyValues(text: string) {
  const found: { negative: boolean; value: number; raw: string; start: number }[] = [];
  for (const match of text.matchAll(MONEY)) {
    const at = match.index ?? 0;
    const dash = match[1] === "-";
    // A dash only means "negative" when it stands alone, not when it joins words ("29-31", "Chrome-").
    const before = text.slice(0, at).replace(/\s-$/, "").slice(-1);
    const negative = dash && !/[\w-]/.test(before);
    const digits = match[2];
    if (!digits) continue;
    found.push({ negative, value: Number(digits.replace(/,/g, "")), raw: match[0], start: at });
  }
  return found;
}

const magnitude = (m: { value: number }) => Math.abs(m.value);
const printed = (m: { raw: string }) => m.raw.replace(/\s+/g, " ").trim();
const iso = (month: string, day: string, year: string) => `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
const joinText = (pending: string, next: string) => {
  const addition = next.trim();
  if (!pending) return addition;
  if (!addition) return pending;
  // A description wrapped after a hyphenated word ("Chrome-" / "Cobalt") is one word; a dash that
  // stands on its own ("… and 30 -" / "Chrome-Cobalt") keeps its space.
  return /[\w][-–—]$/.test(pending) ? `${pending}${addition}` : `${pending} ${addition}`;
};

export function isDandyDocument(text: string) {
  const squashed = squash(text).toLowerCase();
  return DANDY_MARKERS.some((marker) => squashed.includes(marker));
}

function emptyExtraction(): Extraction {
  return { currency: null, issuer: null, source: null, bill_total: null, orders_subtotal: null, sales_tax: null, bill_lines: [], promise_kind: "price_list", refund: null, agreed_items: [] };
}

type BillLine = Extraction["bill_lines"][number];
const line = (over: Partial<BillLine>): BillLine => ({
  kind: "transaction", date: null, description: null, amount: null, type: null, reference_no: null, bank_ref: null,
  order_no: null, tax_amount: null, total_amount: null, ...over,
});

/**
 * Reads a Dandy invoice: one line per item inside each order, credits from the "Credits & Refunds"
 * section, and the printed Orders / Sales Tax / Total Balance summary. Doctor names are never kept.
 */
export function parseDandyInvoice(text: string): Extraction {
  const out = emptyExtraction();
  out.issuer = "ZIMA INTERNATIONAL, INC.";
  const lines = text.split(/\r?\n/).map(readLine).filter((l) => l && !isNoise(l));

  let ordersSubtotal: number | null = null;
  let salesTax: number | null = null;
  let billTotal: number | null = null;
  let creditsPrinted: number | null = null;
  let inCredits = false;
  let order: { date: string | null; order_no: string; tax: number | null; total: number | null } | null = null;
  let pending = "";
  let sawOrder = false;

  for (const raw of lines) {
    const amounts = moneyValues(raw);
    const header = raw.match(HEADER);

    if (header) {
      const [, month, day, year, orderNo, tail] = header;
      if (!month || !day || !year || !orderNo) continue;
      order = { date: iso(month, day, year), order_no: orderNo, tax: null, total: null };
      // Lab order headings carry the doctor and status; credit headings carry the reason.
      pending = /credit\s+for/i.test(tail ?? "") ? (tail ?? "").replace(/^[-–—]\s*/, "").trim() : "";
      inCredits = inCredits || /credit\s+for/i.test(tail ?? "");
      sawOrder = true;
      const onLine = amounts.filter((m) => m.start >= (header.index ?? 0) + header[0].indexOf(tail ?? ""));
      if (onLine.length >= 2) {
        const last = onLine.slice(-3);
        const [, taxOrTotal, total] = last;
        if (taxOrTotal && total) { order.tax = magnitude(taxOrTotal); order.total = magnitude(total); }
        else if (taxOrTotal) order.total = magnitude(taxOrTotal);
      }
      continue;
    }

    if (/^Credits & Refunds$/i.test(raw)) { inCredits = true; order = null; pending = ""; continue; }
    if (/^Subtotal - (?:Lab Work|Credits & Refunds)$/i.test(raw)) { order = null; pending = ""; continue; }

    if (!sawOrder) {
      // The summary block sits above the order table.
      const first = amounts[0];
      if (/^Orders\b/i.test(raw) && first) { ordersSubtotal = first.value; continue; }
      if (/^Credits & Refunds\b/i.test(raw) && first) { creditsPrinted = magnitude(first); continue; }
      if (/^Sales Tax\b/i.test(raw) && first) { salesTax = first.value; continue; }
      if (/^Total Balance\b/i.test(raw) && first) { billTotal = first.value; continue; }
    }
    const [firstAmount, secondAmount] = amounts;
    if (/^Subtotal - Lab Work\b/i.test(raw) && firstAmount && secondAmount) { ordersSubtotal ??= firstAmount.value; salesTax ??= secondAmount.value; continue; }
    if (/^Subtotal - Credits & Refunds\b/i.test(raw) && firstAmount) { creditsPrinted ??= magnitude(firstAmount); continue; }

    if (!order) { pending = joinText(pending, raw); continue; }

    // Credit rows print the doctor before the amount, so only the saved reason is kept.
    if (inCredits && firstAmount) {
      out.bill_lines.push(line({
        date: order.date, description: pending.replace(/^[-–—]\s*/, "").trim(), amount: magnitude(firstAmount),
        type: "credit", order_no: order.order_no, tax_amount: null, total_amount: magnitude(firstAmount),
      }));
      pending = "";
      continue;
    }

    // The wrapped "Open Order" column prints the order's price, tax and total before any item lines.
    if (amounts.length >= 2 && order.tax === null && order.total === null) {
      const last = amounts.slice(-3);
      const [, taxOrTotal, total] = last;
      if (taxOrTotal && total) { order.tax = magnitude(taxOrTotal); order.total = magnitude(total); }
      else if (taxOrTotal) order.total = magnitude(taxOrTotal);
      pending = "";
      continue;
    }

    if (amounts.length === 1 && firstAmount) {
      const money = firstAmount;
      const before = raw.slice(0, money.start).replace(/\s+/g, " ").trim();
      const description = joinText(pending, before).replace(/^[-–—]\s*/, "").replace(/\s+/g, " ").trim();
      pending = "";
      if (!description) continue;
      out.bill_lines.push(line({
        date: order.date, description, amount: magnitude(money), type: "charge",
        order_no: order.order_no, tax_amount: order.tax, total_amount: order.total,
      }));
      continue;
    }

    if (amounts.length === 0) pending = joinText(pending, raw);
  }

  out.orders_subtotal = ordersSubtotal;
  out.sales_tax = salesTax;
  out.bill_total = billTotal;
  out.currency = text.includes("$") ? "USD" : null;
  out.source = null;
  out.refund = null;
  out.agreed_items = [];
  void creditsPrinted;
  return out;
}

type PriceRow = Extraction["agreed_items"][number];
const priceRow = (over: Partial<PriceRow>): PriceRow => ({
  pnr: null, item: null, original_charge: null, promised_amount: null, reference_no: null, transaction_id: null,
  bank_ref: "", promised_on: null, status_text: null, notes: null, ...over,
});

/**
 * Reads the Dandy master pricing list: one row per item with its printed price. Rows priced as
 * "+ Alloy", "N/A", a range, or several column prices are kept but flagged as not comparable.
 */
export function parseDandyPriceList(text: string): Extraction {
  const out = emptyExtraction();
  const lines = text.split(/\r?\n/).map(readLine).filter((l) => l && !isNoise(l));
  for (const raw of lines) {
    if (SECTION_TITLES.test(raw) || raw.startsWith("*")) continue;
    const amounts = moneyValues(raw);
    const na = raw.match(/(?:^|\s)(N\/?A)(?=\s|$)/i);
    if (!amounts.length && !na) continue;

    // The item name stops where the price starts, or where "N/A" stands in place of a price.
    const first = amounts[0];
    const naAt = na ? (na.index ?? 0) + na[0].lastIndexOf("N") : raw.length;
    const cut = first ? first.start : naAt;
    const name = raw.slice(0, cut).replace(/\s+/g, " ").trim().replace(/[:|]+$/, "").trim();
    if (!name || SECTION_TITLES.test(name)) continue;

    const tail = raw.slice(cut).replace(/\s+/g, " ").trim();
    const isRange = /\$\s?[\d,.]+\s?(?:-|–|—|to)\s?\$?\s?[\d,.]+/i.test(tail);
    const alloy = /\+\s*alloy/i.test(tail);

    if (alloy) { out.agreed_items.push(priceRow({ item: name, promised_amount: first?.value ?? null, notes: tail || "+ Alloy" })); continue; }
    if (isRange) { out.agreed_items.push(priceRow({ item: name, promised_amount: null, notes: `Price range ${tail}` })); continue; }
    if (!amounts.length && na) { out.agreed_items.push(priceRow({ item: name, promised_amount: null, notes: "N/A – contact account manager" })); continue; }
    if (na && /\bN\/?A\b/i.test(tail)) { out.agreed_items.push(priceRow({ item: name, promised_amount: null, notes: `Not a fixed price (${tail})` })); continue; }
    if (amounts.length > 1) { out.agreed_items.push(priceRow({ item: name, promised_amount: null, notes: `Several printed prices (${tail})` })); continue; }
    if (!first) continue;

    const note = tail.replace(MONEY, "").replace(/\s+/g, " ").trim();
    out.agreed_items.push(priceRow({ item: name, promised_amount: first.value, notes: note ? `${note} (as printed: ${tail})` : null }));
  }
  out.currency = text.includes("$") ? "USD" : null;
  out.source = "Dandy Lab — Master Pricing List";
  out.issuer = null;
  out.promise_kind = "price_list";
  return out;
}
