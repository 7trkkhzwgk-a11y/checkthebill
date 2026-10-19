import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { normalizeExtraction, type Extraction } from "@/lib/extraction";
import { validateDocumentSize } from "@/lib/extraction-errors";
import type { InFile } from "@/lib/extract.server";

type Client = SupabaseClient<Database>;
export type StoredDocument = { path: string; name: string; mime: string };

export async function loadDocument(client: Client, file: StoredDocument): Promise<InFile> {
  const { data: blob, error } = await client.storage.from("documents").download(file.path);
  if (error || !blob) throw new Error("Couldn't read uploaded file.");
  validateDocumentSize(blob.size);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  // Chunked encoding avoids building a giant character-by-character string.
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += 0x6000) parts.push(btoa(String.fromCharCode(...bytes.subarray(i, i + 0x6000))));
  return { name: file.name, mime: file.mime, base64: parts.join("") };
}

export async function saveExtraction(client: Client, userId: string, billPath: string, promisePath: string, billType: "refund" | "lab_invoice", input: Extraction) {
  const ex = normalizeExtraction(input);
  const { data: bill, error: billErr } = await client.from("bills").insert({
    user_id: userId, issuer: ex.issuer, currency: ex.currency, bill_total: ex.bill_total,
    orders_subtotal: ex.orders_subtotal, sales_tax: ex.sales_tax, bill_type: billType, file_link: billPath,
  }).select("id").single();
  if (billErr || !bill) throw new Error("Couldn't save the bill.");
  try {
    if (ex.bill_lines.length) {
      const { error } = await client.from("line_items").insert(ex.bill_lines.map((l) => ({
        user_id: userId, bill_id: bill.id, date: l.date, description: l.description, amount: l.amount,
        type: l.type, reference_no: l.reference_no, bank_ref: l.bank_ref, order_no: l.order_no,
        tax_amount: l.tax_amount, total_amount: l.total_amount,
      })));
      if (error) throw new Error("Couldn't save invoice lines.");
    }
    if (ex.promise_rows.length) {
      const { error } = await client.from("promises").insert(ex.promise_rows.map((l) => ({
        user_id: userId, bill_id: bill.id, source: ex.source, ...l,
        promise_kind: ex.promise_kind, file_link: promisePath,
      })));
      if (error) throw new Error("Couldn't save the price list.");
    }
    return { billId: bill.id, extraction: ex };
  } catch (error) {
    await client.from("bills").delete().eq("id", bill.id).eq("user_id", userId);
    throw error;
  }
}