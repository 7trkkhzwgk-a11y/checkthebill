import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { extractionSchema } from "@/lib/extraction";
import { extractionErrorMessage } from "@/lib/extraction-errors";
import { combineInvoicePages, maskedExtraction, readingStepError } from "@/lib/invoice-extraction";
import { isDandyDocument, priceListSectionCounts } from "@/lib/dandy";
import { z } from "zod";

const documentSchema = z.object({ path: z.string().min(1), name: z.string(), mime: z.enum(["application/pdf", "image/png", "image/jpeg", "image/webp", "text/plain"]) });
const partSchema = z.object({ file: documentSchema, sourcePath: z.string().optional(), readingId: z.string().uuid(), part: z.enum(["invoice", "price_list", "bill", "refund_promise"]), previousOrder: z.string().nullable().optional(), userNote: z.string().trim().max(4000).optional() });
const CACHE_VERSION = "code-v2-sections";

function ownPath(path: string, userId: string) {
  if (!path.startsWith(`${userId}/`) || path.includes("..")) throw new Error("This file doesn't belong to your account.");
}

export const readInvoicePart = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.infer<typeof partSchema>) => partSchema.parse(input))
  .handler(async ({ data, context }) => {
    const step = data.part === "price_list" ? "Reading price list" : data.part === "refund_promise" ? "Reading refund promise" : "Reading bill pages";
    try {
      ownPath(data.file.path, context.userId);
      if (data.sourcePath) ownPath(data.sourcePath, context.userId);
      const { loadDocument } = await import("@/lib/extraction-storage.server");
      const { extractInvoicePart } = await import("@/lib/extract.server");
      const file = await loadDocument(context.supabase, data.file);
      let cachePath = `${data.file.path}.extraction-${CACHE_VERSION}.json`;
      const { usageSink } = await import("@/lib/ai/usage.server");
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(file.text ?? file.base64 ?? ""));
      const hash = Array.from(new Uint8Array(digest), (v) => v.toString(16).padStart(2, "0")).join("");
      let output;
      let cached = false;
      let readBy: "code" | "ai" = "ai";
      let promiseDetails: import("@/lib/typed-promise").TypedDetails | undefined;
      if (data.part === "price_list") {
        const existing = await context.supabase.from("price_list_cache").select("extraction").eq("user_id", context.userId).eq("content_hash", `${CACHE_VERSION}-${hash}`).maybeSingle();
        if (existing.error) throw new Error("Couldn't read the saved price list.");
        if (existing.data) { output = maskedExtraction(extractionSchema.parse(existing.data.extraction)); cached = true; }
      }
      if (!output) {
        // Dandy lab invoices and price lists are read by deterministic code: no AI call, no tokens.
        const codeText = file.text && (data.part === "invoice" || data.part === "price_list") && isDandyDocument(file.text) ? file.text : null;
        if (codeText) {
          const { parseDandyInvoice, parseDandyPriceList } = await import("@/lib/dandy");
          output = maskedExtraction(data.part === "invoice" ? parseDandyInvoice(codeText) : parseDandyPriceList(codeText));
          readBy = "code";
        } else {
          const { maskSensitive } = await import("@/lib/mask");
          const note = data.part === "refund_promise" || data.part === "price_list" ? maskSensitive(data.userNote) ?? undefined : undefined;
          if (data.part === "refund_promise" || data.part === "price_list") {
            const { readPromiseFile, typedExtraction } = await import("@/lib/typed-promise.server");
            const read = await readPromiseFile(file, note, usageSink(context.supabase, context.userId, data.part, { readingId: data.readingId }));
            const result = typedExtraction(read, "");
            output = result.extraction;
            if (data.part === "refund_promise") {
              output.promise_kind = "refund";
              output.refund = output.refund ?? output.agreed_items[0] ?? null;
              output.agreed_items = [];
            }
            promiseDetails = { ...result.details, source_mode: "document", document_read_failed: !read };
          } else output = maskedExtraction(await extractInvoicePart(file, data.part, data.previousOrder ?? null, usageSink(context.supabase, context.userId, data.part, { readingId: data.readingId })));
        }
        if (data.part === "price_list" && !promiseDetails?.document_read_failed) {
          const { error } = await context.supabase.from("price_list_cache").upsert({ user_id: context.userId, content_hash: `${CACHE_VERSION}-${hash}`, extraction: JSON.parse(JSON.stringify(output)), file_link: data.sourcePath ?? data.file.path }, { onConflict: "user_id,content_hash" });
          if (error) throw new Error("Couldn't save the structured price list.");
        }
      }
      const { error } = await context.supabase.storage.from("documents").upload(cachePath, new Blob([JSON.stringify({ extraction: output, promiseDetails })], { type: "application/json" }), { contentType: "application/json", upsert: true });
      if (error) throw new Error("Couldn't save the privately cached reading.");
      return { ok: true as const, cachePath, lastOrder: output.bill_lines.at(-1)?.order_no ?? null, cached, readBy, sections: data.part === "price_list" ? priceListSectionCounts(output.agreed_items) : [] };
    } catch (error) {
      const message = readingStepError(step, extractionErrorMessage(error));
      console.error("Invoice reading step failed", { step, message });
      return { ok: false as const, error: message };
    }
  });

const finishSchema = z.object({ bill: documentSchema, promise: documentSchema.optional(), typedPromise: z.string().trim().min(1).max(4000).optional(), readingId: z.string().uuid(), billType: z.enum(["refund", "lab_invoice"]), pages: z.array(z.string()).min(1), priceList: z.array(z.string()) }).refine(data => !!data.promise || !!data.typedPromise, "What were you promised? Upload a screenshot or type it in one line.");
export const finishInvoiceReading = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.infer<typeof finishSchema>) => finishSchema.parse(input))
  .handler(async ({ data, context }) => {
    let step = "Combining invoice pages";
    try {
      for (const path of [data.bill.path, ...(data.promise ? [data.promise.path] : []), ...data.priceList, ...data.pages]) ownPath(path, context.userId);
      if (new Set(data.pages).size !== data.pages.length) throw new Error("An invoice page was supplied twice.");
      const read = async (path: string) => {
        const { data: blob, error } = await context.supabase.storage.from("documents").download(path);
        if (error || !blob) throw new Error("A completed reading is missing. Read the files again.");
        const raw = JSON.parse(await blob.text());
        const { typedDetailsSchema } = await import("@/lib/typed-promise");
        return { extraction: extractionSchema.parse(raw.extraction ?? raw), details: raw.promiseDetails ? typedDetailsSchema.parse(raw.promiseDetails) : undefined };
      };
      const pages = [];
      for (const path of data.pages) pages.push((await read(path)).extraction);
      const promises = [];
      let documentDetails: import("@/lib/typed-promise").TypedDetails | undefined;
      for (const path of data.priceList) {
        try { const result = await read(path); promises.push(result.extraction); documentDetails = result.details ?? documentDetails; }
        catch { /* Failed promise readings never prevent manual confirmation. */ }
      }
      const { typedExtraction } = await import("@/lib/typed-promise.server");
      let typed;
      let typedRead: Awaited<ReturnType<typeof import("@/lib/typed-promise.server").readTypedPromise>> = null;
      if (data.typedPromise) {
        step = "Reading the promise you entered";
        const { readTypedPromise } = await import("@/lib/typed-promise.server");
        const { usageSink } = await import("@/lib/ai/usage.server");
        // Never throws: a failed reading becomes a plain promise note for the user to fill in.
        typedRead = await readTypedPromise(data.typedPromise, usageSink(context.supabase, context.userId, "typed_promise", { readingId: data.readingId }));
        if (!data.promise) { typed = typedExtraction(typedRead, data.typedPromise); promises.push(typed.extraction); }
      }
      if (!promises.length) {
        const fallback = typedExtraction(null, data.typedPromise ?? "");
        if (data.billType === "refund") { fallback.extraction.promise_kind = "refund"; fallback.extraction.refund = fallback.extraction.agreed_items[0] ?? null; fallback.extraction.agreed_items = []; }
        promises.push(fallback.extraction);
        documentDetails = { ...fallback.details, document_read_failed: true, source_mode: "document" };
      }
      const firstPromise = promises[0];
      if (!firstPromise) throw new Error("Promise reading is missing.");
      const promise = { ...firstPromise, agreed_items: promises.flatMap((p) => p.agreed_items) };
      const combined = combineInvoicePages(pages, promise);
      if ((typed && typed.details.kind === "refund") || (!typed && data.billType === "refund")) { combined.promise_kind = "refund"; combined.refund = promises.find((p) => p.refund)?.refund ?? null; combined.agreed_items = []; }
      else if (typed) combined.promise_kind = "contract";
      const { mergePromiseFields } = await import("@/lib/promise-source");
      const { maskSensitive } = await import("@/lib/mask");
      const note = maskSensitive(data.typedPromise) ?? "";
      const rows = combined.promise_kind === "refund" ? [combined.refund ?? typedExtraction(null, "").extraction.agreed_items[0]].filter((r): r is NonNullable<typeof r> => !!r) : combined.agreed_items;
      const metadata: import("@/lib/typed-promise").TypedDetails[] = [];
      const normalized = (v: string | null) => (v ?? "").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
      const named = typedRead?.item ? rows.filter(row => normalized(row.item) === normalized(typedRead?.item ?? null)) : [];
      const target = rows.length === 1 ? rows[0] : named.length === 1 ? named[0] : undefined;
      if (!target && typedRead && (typedRead.item || typedRead.amount != null || typedRead.taxes.length)) {
        const extra = typedExtraction(typedRead, note);
        rows.push(extra.extraction.refund ?? extra.extraction.agreed_items[0] ?? { item: null, original_charge: null, promised_amount: null, reference_no: null, transaction_id: null, bank_ref: "", promised_on: null, status_text: null });
      }
      const actualTarget = target ?? (typedRead ? rows.at(-1) : undefined);
      for (const [index, row] of rows.entries()) {
        const applies = row === actualTarget;
        const fromFile = !!data.promise && (row === target || index < rows.length - (actualTarget && !target ? 1 : 0));
        const merged = mergePromiseFields(row, combined.source, fromFile ? { item: row.item, amount: row.promised_amount, date: row.promised_on, who_promised: combined.source, taxes: documentDetails?.taxes, tax_inclusive: documentDetails?.tax_inclusive } : null, applies ? typedRead : null, note, fromFile ? data.promise?.name ?? null : null);
        rows[index] = merged.row;
        if (applies) combined.source = merged.source;
        metadata.push({ ...(typed?.details ?? documentDetails ?? { kind: combined.promise_kind === "refund" ? "refund" : "price", tax_inclusive: null, taxes: [] }), ...merged.evidence, kind: combined.promise_kind === "refund" ? "refund" : "price", tax_inclusive: merged.tax_inclusive, taxes: merged.taxes.map(t => ({ ...t, taxable_amount: null })), promise_note: note, read_failed: !!data.typedPromise && !typedRead, document_read_failed: !!data.promise && (!data.priceList.length || !!documentDetails?.document_read_failed) });
      }
      if (combined.promise_kind === "refund") combined.refund = rows[0] ?? null;
      else combined.agreed_items = rows;
      step = "Saving invoice check";
      const { saveExtraction } = await import("@/lib/extraction-storage.server");
      const saved = await saveExtraction(context.supabase, context.userId, data.bill.path, data.promise?.path ?? null, data.billType, combined, metadata);
      const { error: usageError } = await context.supabase.from("ai_usage").update({ bill_id: saved.billId }).eq("user_id", context.userId).eq("reading_id", data.readingId);
      if (usageError) throw new Error("Couldn't attach AI token usage to the check.");
      await context.supabase.storage.from("documents").remove([...data.pages, ...data.priceList]);
      return { ok: true as const, billId: saved.billId };
    } catch (error) {
      return { ok: false as const, error: readingStepError(step, extractionErrorMessage(error)) };
    }
  });

export const replaceDandyPriceList = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ billId: z.string().uuid(), file: documentSchema }).parse(input))
  .handler(async ({ data, context }) => {
    ownPath(data.file.path, context.userId);
    const bill = await context.supabase.from("bills").select("bill_type").eq("id", data.billId).eq("user_id", context.userId).single();
    const old = await context.supabase.from("promises").select("id,file_link,promise_kind").eq("bill_id", data.billId).eq("user_id", context.userId);
    if (bill.error || bill.data?.bill_type !== "lab_invoice" || old.error || !old.data?.length || old.data.some(p => p.promise_kind !== "price_list")) throw new Error("Couldn't load this lab price list.");
    const sourcePath = old.data[0]?.file_link;
    if (!sourcePath || data.file.mime !== "text/plain") throw new Error("The original price-list file is missing.");
    ownPath(sourcePath, context.userId);
    const { loadDocument } = await import("@/lib/extraction-storage.server");
    const { parseDandyPriceList } = await import("@/lib/dandy");
    const { normalizeExtraction } = await import("@/lib/extraction");
    const file = await loadDocument(context.supabase, data.file);
    if (!file.text || !isDandyDocument(file.text)) throw new Error("This file doesn't contain a readable Dandy price list.");
    const extraction = maskedExtraction(parseDandyPriceList(file.text));
    const normalized = normalizeExtraction(extraction);
    if (!normalized.promise_rows.length) throw new Error("No price-list rows were read. The saved list has not been changed.");
    const rows = normalized.promise_rows.map(p => ({ ...p, source: normalized.source, user_id: context.userId, bill_id: data.billId, promise_kind: "price_list", file_link: sourcePath }));
    const inserted = await context.supabase.from("promises").insert(rows).select("id");
    if (inserted.error) throw new Error("Couldn't save the corrected price list. The old list is unchanged.");
    const removed = await context.supabase.from("promises").delete().eq("bill_id", data.billId).eq("user_id", context.userId).in("id", old.data.map(p => p.id));
    if (removed.error) {
      await context.supabase.from("promises").delete().eq("user_id", context.userId).in("id", (inserted.data ?? []).map(p => p.id));
      throw new Error("Couldn't replace the old price list. Try again.");
    }
    const cleared = await context.supabase.from("price_list_cache").delete().eq("user_id", context.userId).eq("file_link", sourcePath);
    if (cleared.error) throw new Error("The corrected rows are saved, but the old price-list cache couldn't be removed.");
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(file.text));
    const hash = Array.from(new Uint8Array(digest), v => v.toString(16).padStart(2, "0")).join("");
    const cached = await context.supabase.from("price_list_cache").upsert({ user_id: context.userId, content_hash: `${CACHE_VERSION}-${hash}`, extraction: JSON.parse(JSON.stringify(extraction)), file_link: sourcePath }, { onConflict: "user_id,content_hash" });
    if (cached.error) throw new Error("The corrected rows are saved, but caching failed. Try reading again.");
    return { sections: priceListSectionCounts(extraction.agreed_items), count: rows.length };
  });