import { z } from "zod";
import { maskSensitive } from "@/lib/mask";

const line = z.object({
  kind: z.enum(["transaction", "summary", "header", "footer"]),
  date: z.string().nullable(),
  description: z.string().nullable(),
  amount: z.number().nullable(),
  type: z.enum(["charge", "credit"]).nullable(),
  reference_no: z.string().nullable(),
  bank_ref: z.string().nullable(),
  order_no: z.string().nullable().optional(),
  tax_amount: z.number().nullable().optional(),
  total_amount: z.number().nullable().optional(),
});
const promise = z.object({
  pnr: z.string().nullable().optional(),
  item: z.string().nullable(),
  original_charge: z.number().nullable(),
  promised_amount: z.number().nullable(),
  reference_no: z.string().nullable(),
  transaction_id: z.string().nullable(),
  bank_ref: z.string().nullable(),
  promised_on: z.string().nullable(),
  status_text: z.string().nullable(),
  notes: z.string().nullable().optional(),
});
export const extractionSchema = z.object({
  currency: z.string().nullable().optional(),
  issuer: z.string().nullable(),
  source: z.string().nullable(),
  bill_total: z.number().nullable(),
  orders_subtotal: z.number().nullable().optional(),
  sales_tax: z.number().nullable().optional(),
  bill_lines: z.array(line),
  promise_kind: z.enum(["refund", "contract", "price_list"]),
  refund: promise.nullable(),
  agreed_items: z.array(promise),
});
export type Extraction = z.infer<typeof extractionSchema>;

// Legacy saved inputs may omit these fields; the strict AI wire schema may not.
const outputPromise = promise.extend({ pnr: z.string().nullable() });
export const extractionOutputSchema = extractionSchema.extend({
  currency: z.string().nullable(),
  refund: outputPromise.nullable(),
  agreed_items: z.array(outputPromise),
});

export function toDate(value: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : value;
}

const summaryLabel = /^(?:(?:opening|closing|previous|new|statement|outstanding|available|ending|beginning)\s+balance|balance\s+(?:brought|carried)\s+forward|(?:grand\s+)?total(?:\s+(?:charges|credits|payments|transactions|amount|refunds?))?|(?:minimum\s+)?(?:amount|payment)\s+due)\s*[:\-]?\s*(?:[₹$€£]?\s*[\d,.]+)?$/i;

export function normalizeExtraction(ex: Extraction) {
  const rows = ex.promise_kind === "refund"
    ? [ex.refund ?? { item: null, original_charge: null, promised_amount: null, reference_no: null, transaction_id: null, bank_ref: null, promised_on: null, status_text: null }]
    : ex.agreed_items;
  return {
    currency: ex.currency && /^[A-Z]{3}$/.test(ex.currency) ? ex.currency : null,
    issuer: maskSensitive(ex.issuer),
    source: maskSensitive(ex.source),
    promise_kind: ex.promise_kind,
    bill_total: ex.bill_total,
    orders_subtotal: ex.orders_subtotal ?? null,
    sales_tax: ex.sales_tax ?? null,
    bill_lines: ex.bill_lines
      .filter((l) => l.kind === "transaction" && (l.type === "charge" || l.type === "credit") && !summaryLabel.test(l.description?.trim() ?? ""))
      .map(({ kind: _kind, ...l }) => ({ ...l, date: toDate(l.date), description: maskSensitive(l.description), reference_no: maskSensitive(l.reference_no, "identifier"), bank_ref: maskSensitive(l.bank_ref, "identifier"), order_no: maskSensitive(l.order_no ?? null, "identifier"), tax_amount: l.tax_amount ?? null, total_amount: l.total_amount ?? null })),
    promise_rows: rows.map((p) => ({ ...p, pnr: maskSensitive(p.pnr ?? null, "identifier"), item: maskSensitive(p.item), status_text: maskSensitive(p.status_text), notes: maskSensitive(p.notes ?? null), reference_no: maskSensitive(p.reference_no, "identifier"), transaction_id: maskSensitive(p.transaction_id, "identifier"), bank_ref: maskSensitive(p.bank_ref ?? "", "identifier"), promised_on: toDate(p.promised_on) })),
  };
}