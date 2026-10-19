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
      if (words.length >= 2 && words.filter(isShortWord).length / words.length >= 0.6) return words.join("");
      return token;
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
    found.push({ negative, value: Number(match[2].replace(/,/g, "")), raw: match[0], start: at });
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
  // A description wrapped after a hyphen ("Chrome-" / "Cobalt") is one word, not two.
  return /[-–—]$/.test(pending) && !/\s$/.test(pending) ? `${pending}${addition}` : `${pending} ${addition}`;
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
      order = { date: iso(month, day, year), order_no: orderNo, tax: null, total: null };
      // Lab order headings carry the doctor and status; credit headings carry the reason.
      pending = /credit\s+for/i.test(tail ?? "") ? (tail ?? "").replace(/^[-–—]\s*/, "").trim() : "";
      inCredits = inCredits || /credit\s+for/i.test(tail ?? "");
      sawOrder = true;
      const onLine = amounts.filter((m) => m.start >= header.index! + header[0].indexOf(tail ?? ""));
      if (onLine.length >= 2) {
        const last = onLine.slice(-3);
        if (last.length === 3) { order.tax = magnitude(last[1]); order.total = magnitude(last[2]); }
        else order.total = magnitude(last[1]);
      }
      continue;
    }

    if (/^Credits & Refunds$/i.test(raw)) { inCredits = true; order = null; pending = ""; continue; }
    if (/^Subtotal - (?:Lab Work|Credits & Refunds)$/i.test(raw)) { order = null; pending = ""; continue; }

    if (!sawOrder) {
      // The summary block sits above the order table.
      if (/^Orders\b/i.test(raw) && amounts.length) { ordersSubtotal = amounts[0].value; continue; }
      if (/^Credits & Refunds\b/i.test(raw) && amounts.length) { creditsPrinted = magnitude(amounts[0]); continue; }
      if (/^Sales Tax\b/i.test(raw) && amounts.length) { salesTax = amounts[0].value; continue; }
      if (/^Total Balance\b/i.test(raw) && amounts.length) { billTotal = amounts[0].value; continue; }
    }
    if (/^Subtotal - Lab Work\b/i.test(raw) && amounts.length >= 2) { ordersSubtotal ??= amounts[0].value; salesTax ??= amounts[1].value; continue; }
    if (/^Subtotal - Credits & Refunds\b/i.test(raw) && amounts.length) { creditsPrinted ??= magnitude(amounts[0]); continue; }

    if (!order) { pending = joinText(pending, raw); continue; }

    // Credit rows print the doctor before the amount, so only the saved reason is kept.
    if (inCredits && amounts.length) {
      out.bill_lines.push(line({
        date: order.date, description: pending.replace(/^[-–—]\s*/, "").trim(), amount: magnitude(amounts[0]),
        type: "credit", order_no: order.order_no, tax_amount: null, total_amount: magnitude(amounts[0]),
      }));
      pending = "";
      continue;
    }

    // The wrapped "Open Order" column prints the order's price, tax and total before any item lines.
    if (amounts.length >= 2 && order.tax === null && order.total === null) {
      const last = amounts.slice(-3);
      if (last.length === 3) { order.tax = magnitude(last[1]); order.total = magnitude(last[2]); }
      else order.total = magnitude(last[1]);
      pending = "";
      continue;
    }

    if (amounts.length === 1) {
      const money = amounts[0];
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
    const hasNA = /(?:^|[\s|])N\/?A(?:$|[\s|])/i.test(raw);
    if (!amounts.length && !hasNA) continue;

    const first = amounts[0];
    const name = (first ? raw.slice(0, first.start) : raw).replace(/\s+/g, " ").trim().replace(/[:|]+$/, "").trim();
    if (!name || SECTION_TITLES.test(name)) continue;

    const tail = (first ? raw.slice(first.start) : raw.slice(name.length)).replace(/\s+/g, " ").trim();
    const isRange = /\$\s?[\d,.]+\s?(?:-|–|—|to)\s?\$?\s?[\d,.]+/i.test(tail);
    const alloy = /\+\s*alloy/i.test(tail);

    if (alloy) { out.agreed_items.push(priceRow({ item: name, promised_amount: first?.value ?? null, notes: tail || "+ Alloy" })); continue; }
    if (isRange) { out.agreed_items.push(priceRow({ item: name, promised_amount: null, notes: `Price range ${tail}` })); continue; }
    if (!amounts.length && hasNA) { out.agreed_items.push(priceRow({ item: name, promised_amount: null, notes: "N/A – contact account manager" })); continue; }
    if (hasNA && /\bN\/?A\b/i.test(tail)) { out.agreed_items.push(priceRow({ item: name, promised_amount: null, notes: `Not a fixed price (${tail})` })); continue; }
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
