import { describe, expect, it } from "vitest";
import { isDandyDocument, parseDandyInvoice, parseDandyPriceList, readLine } from "@/lib/dandy";
import { isComparablePromise, lineQuantity, reconcileInvoice } from "@/lib/comparison";
import { maskedExtraction } from "@/lib/invoice-extraction";

// Synthetic Dandy-shaped text: pdf.js reads these PDFs letter-spaced (one space inside a word,
// two or more between words), so the fixtures are written the same way the app receives them.
const INVOICE = [
  "PAGE 1 OF 2",
  "I n vo ice   n u mbe r   #90001-1111-001",
  "Z I M A   I NT E RN A T I ON A L ,   I N C .",
  "B illing a nd C o llec t i o n s @ mee t d a nd y . c o m",
  "O r de rs   2   $ 400.00",
  "C r edi ts   &   R ef u nd s   1   - $ 20.00",
  "Sa le s   Ta x   $ 36.00",
  "T ot a l   B a l a nce   $ 416.00",
  "La b   W or k",
  "D a t e   D e s c r i pt i o n   D o c tor   P r ice   Sa le s   Ta x   T ot a l",
  "01/05/2026   O r de r   #111-222-333   -   D o c t o r   O n e   O p en",
  "O r de r   $ 300.00   $ 27.00   $ 327.00",
  "S ign a tur e   D en tur e   B u ndle   -   Wa x   R im",
  "W or kfl ow   ( x 2)",
  "$ 300.00",
  "01/06/2026   O r de r   #111-222-444   -   D o c t o r   T w o   O p en",
  "O r de r   $ 100.00   $ 9.00   $ 109.00",
  "C r own   7   -   Z ir c on ia   M o n o li t hic   $ 100.00",
  "R em ov a ble   M o del   -   D u a l   F u ll   A r ch   $ 0.00",
  "S u b tot a l   -   La b   W or k   $ 400.00   $ 36.00   $ 436.00",
  "C r edi ts   &   R ef u nd s",
  "D a t e   D e s c r i pt i o n   D o c tor   P r ice   Sa le s   Ta x   T ot a l",
  "01/07/2026   O r de r   #111-222-333   -   C r edi t   f or",
  "N o   R us h   S hi pp ing",
  "D o c t o r   O n e   - $ 20.00   - $ 20.00",
  "S u b tot a l   -   C r edi ts   &   R ef u nd s   - $ 20.00   $ 0.00   - $ 20.00",
].join("\n");

const PRICE_LIST = [
  "D a nd y   L a b — M a s t e r   P r ic in g   L i st",
  "S o u rc e :   p r a c t ic e . mee t d a nd y . c o m / my_practice / pricing",
  "1. C r own   &   B r idge",
  "M a t e r ia ls",
  "Z ir c on ia   M o n o li t hic   $ 75",
  "P FM   -   N o ble   -   W hi te   $ 169   +   A ll o y",
  "M o de l   1   p er   o r de r   $ 20 - $ 50",
  "C o m p o s it e   S t ent   N / A   -   P l e a s e   c o nt a c t   y o u r   A c c o u nt   M a n a g er",
  "F u ll   C o nt o u r   Z ir c on ia   $ 374   $ 374   $ 325",
].join("\n");

describe("Dandy document detection", () => {
  it("recognises a Dandy invoice and price list from their letter-spaced text", () => {
    expect(isDandyDocument(INVOICE)).toBe(true);
    expect(isDandyDocument(PRICE_LIST)).toBe(true);
  });

  it("does not claim an unrelated statement", () => {
    expect(isDandyDocument("DEMO BANK\nCard statement\nPayment 1200.00")).toBe(false);
  });
});

describe("readLine", () => {
  it("re-joins letter-spaced words and leaves printed numbers alone", () => {
    expect(readLine("Pa rt i a l   D en tur e   4,   5,   a nd   13   -   C h ro me -")).toBe("Partial Denture 4, 5, and 13 - Chrome-");
    expect(readLine("Zirconia Monolithic   $75")).toBe("Zirconia Monolithic $75");
    expect(readLine("In v oice")).toBe("Invoice");
  });
});

describe("parseDandyInvoice", () => {
  const parsed = parseDandyInvoice(INVOICE);

  it("keeps one item line per item with its order number, printed date, pre-tax price, order tax and order total", () => {
    expect(parsed.bill_lines).toHaveLength(4);
    expect(parsed.bill_lines[0]).toMatchObject({ date: "2026-01-05", description: "Signature Denture Bundle - Wax Rim Workflow (x2)", amount: 300, type: "charge", order_no: "111-222-333", tax_amount: 27, total_amount: 327 });
    expect(parsed.bill_lines[1]).toMatchObject({ description: "Crown 7 - Zirconia Monolithic", amount: 100, order_no: "111-222-444", tax_amount: 9, total_amount: 109 });
  });

  it("keeps a zero-priced item so it is shown as included", () => {
    const model = parsed.bill_lines.find((l) => l.description === "Removable Model - Dual Full Arch");
    expect(model?.amount).toBe(0);
    expect(model?.order_no).toBe("111-222-444");
  });

  it("keeps the printed quantity marker so quantity 2 is still readable", () => {
    expect(lineQuantity(parsed.bill_lines[0]?.description ?? null)).toBe(2);
  });

  it("saves the credit as a positive credit line on its own order, without the doctor name", () => {
    const credits = parsed.bill_lines.filter((l) => l.type === "credit");
    expect(credits).toHaveLength(1);
    expect(credits[0]).toMatchObject({ description: "Credit for No Rush Shipping", amount: 20, order_no: "111-222-333", date: "2026-01-07" });
  });

  it("never stores a doctor name", () => {
    expect(parsed.bill_lines.some((l) => /doctor/i.test(l.description ?? ""))).toBe(false);
  });

  it("copies the printed summary instead of computing it", () => {
    expect(parsed).toMatchObject({ orders_subtotal: 400, sales_tax: 36, bill_total: 416, currency: "USD", issuer: "ZIMA INTERNATIONAL, INC.", promise_kind: "price_list" });
    expect(parsed.refund).toBeNull();
    expect(parsed.agreed_items).toEqual([]);
  });

  it("reconciles items, tax once per order, credits and total against the printed summary", () => {
    const lines = parsed.bill_lines.map((l, i) => ({ id: `00000000-0000-4000-8000-0000000000${i}`, date: l.date, description: l.description, amount: l.amount, type: l.type ?? "charge", reference_no: null, bank_ref: null, order_no: l.order_no, tax_amount: l.tax_amount, total_amount: l.total_amount }));
    const check = reconcileInvoice(lines, parsed.orders_subtotal ?? null, { sales_tax: parsed.sales_tax, bill_total: parsed.bill_total });
    expect(check).toMatchObject({ items_total: "400.00", orders_subtotal: "400.00", matches: true, tax_total: "36.00", tax_matches: true, credits_total: "20.00", credits_matches: true, total: "416.00", total_matches: true });
    expect(check.tax_conflicts).toEqual([]);
  });

  it("survives privacy masking without losing identifiers", () => {
    const masked = maskedExtraction(parsed);
    expect(masked.bill_lines.map((l) => l.description)).toContain("Crown 7 - Zirconia Monolithic");
    expect(masked.bill_lines.map((l) => l.order_no)).toContain("111-222-444");
    expect(masked.issuer).toBe("ZIMA INTERNATIONAL, INC.");
  });
});

describe("parseDandyPriceList", () => {
  const parsed = parseDandyPriceList(PRICE_LIST);

  it("saves one row per item with its fixed agreed price", () => {
    const zirconia = parsed.agreed_items.find((p) => p.item === "Zirconia Monolithic");
    expect(zirconia?.promised_amount).toBe(75);
    expect(isComparablePromise({ item: zirconia?.item ?? null, promised_amount: zirconia?.promised_amount ?? null, notes: zirconia?.notes ?? null })).toBe(true);
  });

  it("marks + Alloy, N/A, price ranges and multi-column rows as not comparable", () => {
    for (const name of ["PFM - Noble - White", "Composite Stent", "Model 1 per order", "Full Contour Zirconia"]) {
      const row = parsed.agreed_items.find((p) => p.item === name);
      expect(row, name).toBeTruthy();
      expect(isComparablePromise({ item: row?.item ?? null, promised_amount: row?.promised_amount ?? null, notes: row?.notes ?? null }), name).toBe(false);
    }
  });

  it("records the price list source and currency", () => {
    expect(parsed.source).toBe("Dandy Lab — Master Pricing List");
    expect(parsed.currency).toBe("USD");
    expect(parsed.promise_kind).toBe("price_list");
    expect(parsed.bill_lines).toEqual([]);
  });
});
