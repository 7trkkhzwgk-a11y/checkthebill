import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { normalizeExtraction } from "@/lib/extraction";

type Input = {
  bill: { path: string; name: string; mime: string };
  promise: { path: string; name: string; mime: string };
};

const ALLOWED = ["application/pdf", "image/png", "image/jpeg", "image/webp"];

function toBase64(buf: ArrayBuffer) {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

export const runExtraction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: Input) => {
    for (const f of [input.bill, input.promise]) {
      if (!f?.path || !ALLOWED.includes(f.mime)) throw new Error("Unsupported file type.");
    }
    return input;
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    for (const f of [data.bill, data.promise]) {
      if (!f.path.startsWith(`${userId}/`)) throw new Error("Forbidden");
    }

    const load = async (f: Input["bill"]) => {
      const { data: blob, error } = await supabase.storage.from("documents").download(f.path);
      if (error || !blob) throw new Error("Couldn't read uploaded file.");
      return { name: f.name, mime: f.mime, base64: toBase64(await blob.arrayBuffer()) };
    };
    const [billFile, promiseFile] = await Promise.all([load(data.bill), load(data.promise)]);

    const { extractLines } = await import("@/lib/extract.server");
    const ex = normalizeExtraction(await extractLines(billFile, promiseFile));

    const { data: bill, error: billErr } = await supabase
      .from("bills")
      .insert({ user_id: userId, issuer: ex.issuer, bill_total: ex.bill_total, file_link: data.bill.path })
      .select("id")
      .single();
    if (billErr || !bill) throw new Error(billErr?.message ?? "Couldn't save bill.");

    if (ex.bill_lines.length) {
      const { error } = await supabase.from("line_items").insert(
        ex.bill_lines.map((l) => ({
          user_id: userId,
          bill_id: bill.id,
          date: l.date,
          description: l.description,
          amount: l.amount,
          type: l.type,
          reference_no: l.reference_no,
          bank_ref: l.bank_ref,
        })),
      );
      if (error) throw new Error(error.message);
    }

    const promiseRows = ex.promise_rows;
    const { error: pErr } = await supabase.from("promises").insert(
      promiseRows.map((l) => ({
        user_id: userId,
        bill_id: bill.id,
        source: ex.source,
        ...l,
        file_link: data.promise.path,
      })),
    );
    if (pErr) throw new Error(pErr.message);

    return { billId: bill.id };
  });
