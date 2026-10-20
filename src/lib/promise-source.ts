import { z } from "zod";

export const promiseEvidenceSchema = z.object({
  source_mode: z.enum(["document", "typed", "both"]).optional(),
  document_name: z.string().max(500).nullable().optional(),
  field_sources: z.record(z.enum(["document", "you"])).optional(),
  conflicts: z.array(z.object({ field: z.string(), document: z.string().max(2000), you: z.string().max(2000) })).max(20).optional(),
  document_read_failed: z.boolean().optional(),
});
export type PromiseEvidence = z.infer<typeof promiseEvidenceSchema>;
export type PromiseFields = { item: string | null; amount: number | null; date: string | null; who_promised: string | null; tax_inclusive?: boolean | null; taxes?: { label: string; rate: number }[]; notes?: string | null };
export type PromiseRow = { item: string | null; promised_amount: number | null; promised_on: string | null; notes?: string | null };

export function mergePromiseFields<R extends PromiseRow>(row: R, source: string | null, document: PromiseFields | null, typed: PromiseFields | null, note: string, documentName: string | null) {
  const next = { ...row };
  let nextSource = source;
  const evidence: PromiseEvidence = { source_mode: documentName ? note ? "both" : "document" : "typed", document_name: documentName, field_sources: {}, conflicts: [] };
  const fields = evidence.field_sources ?? {};
  const conflicts = evidence.conflicts ?? [];
  const pairs: [string, unknown, unknown, (value: string | number) => void][] = [
    ["item", row.item, typed?.item, v => { next.item = String(v); }],
    ["promised_amount", row.promised_amount, typed?.amount, v => { next.promised_amount = Number(v); }],
    ["promised_on", row.promised_on, typed?.date, v => { next.promised_on = String(v); }],
    ["source", source, typed?.who_promised, v => { nextSource = String(v); }],
  ];
  for (const [key, base, mine, set] of pairs) {
    if (base != null && base !== "") fields[key] = documentName ? "document" : "you";
    if (mine == null || mine === "") continue;
    if (documentName && base != null && base !== "" && String(base) !== String(mine)) conflicts.push({ field: key, document: String(base), you: String(mine) });
    set(typeof mine === "number" ? mine : String(mine));
    fields[key] = "you";
  }
  const taxes = [...(document?.taxes ?? [])];
  for (const tax of typed?.taxes ?? []) {
    const index = taxes.findIndex(t => t.label.toLowerCase() === tax.label.toLowerCase());
    const previous = taxes[index];
    if (previous && previous.rate !== tax.rate) conflicts.push({ field: `tax:${tax.label}`, document: `${previous.rate}%`, you: `${tax.rate}%` });
    if (index >= 0) taxes[index] = tax; else taxes.push(tax);
    fields[`tax:${tax.label}`] = "you";
  }
  for (const tax of document?.taxes ?? []) fields[`tax:${tax.label}`] ??= "document";
  if (document?.tax_inclusive != null) fields.tax_inclusive = "document";
  if (typed?.tax_inclusive != null) {
    if (documentName && document?.tax_inclusive != null && document.tax_inclusive !== typed.tax_inclusive) conflicts.push({ field: "tax_inclusive", document: String(document.tax_inclusive), you: String(typed.tax_inclusive) });
    fields.tax_inclusive = "you";
  }
  if (note) fields.notes = "you";
  next.notes = [row.notes, typed?.notes].filter(Boolean).join(" · ") || null;
  return { row: next, source: nextSource, evidence, taxes, tax_inclusive: typed?.tax_inclusive ?? document?.tax_inclusive ?? null };
}

export function hasPromiseInput(file: unknown, text: string) { return !!file || !!text.trim(); }