import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { extractionSchema } from "@/lib/extraction";
import { extractionErrorMessage } from "@/lib/extraction-errors";
import { combineInvoicePages, maskedExtraction, readingStepError } from "@/lib/invoice-extraction";
import { z } from "zod";

const documentSchema = z.object({ path: z.string().min(1), name: z.string(), mime: z.enum(["application/pdf", "image/png", "image/jpeg", "image/webp", "text/plain"]) });
const partSchema = z.object({ file: documentSchema, readingId: z.string().uuid(), part: z.enum(["invoice", "price_list", "bill", "refund_promise"]), previousOrder: z.string().nullable().optional() });
const CACHE_VERSION = "groq-v1";

function ownPath(path: string, userId: string) {
  if (!path.startsWith(`${userId}/`) || path.includes("..")) throw new Error("This file doesn't belong to your account.");
}

export const readInvoicePart = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.infer<typeof partSchema>) => partSchema.parse(input))
  .handler(async ({ data, context }) => {
    const step = data.part === "price_list" ? "Reading price list" : "Reading invoice page";
    try {
      ownPath(data.file.path, context.userId);
      const { loadDocument } = await import("@/lib/extraction-storage.server");
      const { extractInvoicePart } = await import("@/lib/extract.server");
      const file = await loadDocument(context.supabase, data.file);
      let cachePath = `${data.file.path}.extraction-${CACHE_VERSION}.json`;
      const { usageSink } = await import("@/lib/ai/usage.server");
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(file.text ?? file.base64 ?? ""));
      const hash = Array.from(new Uint8Array(digest), (v) => v.toString(16).padStart(2, "0")).join("");
      let output;
      let cached = false;
      if (data.part === "price_list") {
        const existing = await context.supabase.from("price_list_cache").select("extraction").eq("user_id", context.userId).eq("content_hash", `${CACHE_VERSION}-${hash}`).maybeSingle();
        if (existing.error) throw new Error("Couldn't read the saved price list.");
        if (existing.data) { output = maskedExtraction(extractionSchema.parse(existing.data.extraction)); cached = true; }
      }
      if (!output) {
        output = maskedExtraction(await extractInvoicePart(file, data.part, data.previousOrder ?? null, usageSink(context.supabase, context.userId, data.part, { readingId: data.readingId })));
        if (data.part === "price_list") {
          const { error } = await context.supabase.from("price_list_cache").upsert({ user_id: context.userId, content_hash: `${CACHE_VERSION}-${hash}`, extraction: JSON.parse(JSON.stringify(output)), file_link: data.file.path }, { onConflict: "user_id,content_hash" });
          if (error) throw new Error("Couldn't save the structured price list.");
        }
      }
      const { error } = await context.supabase.storage.from("documents").upload(cachePath, new Blob([JSON.stringify(output)], { type: "application/json" }), { contentType: "application/json", upsert: true });
      if (error) throw new Error("Couldn't save the privately cached reading.");
      return { ok: true as const, cachePath, lastOrder: output.bill_lines.at(-1)?.order_no ?? null, cached };
    } catch (error) {
      const message = readingStepError(step, extractionErrorMessage(error));
      console.error("Invoice reading step failed", { step, message });
      return { ok: false as const, error: message };
    }
  });

const finishSchema = z.object({ bill: documentSchema, promise: documentSchema, readingId: z.string().uuid(), billType: z.enum(["refund", "lab_invoice"]), pages: z.array(z.string()).min(1), priceList: z.array(z.string()).min(1) });
export const finishInvoiceReading = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.infer<typeof finishSchema>) => finishSchema.parse(input))
  .handler(async ({ data, context }) => {
    let step = "Combining invoice pages";
    try {
      for (const path of [data.bill.path, data.promise.path, ...data.priceList, ...data.pages]) ownPath(path, context.userId);
      if (new Set(data.pages).size !== data.pages.length) throw new Error("An invoice page was supplied twice.");
      const read = async (path: string) => {
        const { data: blob, error } = await context.supabase.storage.from("documents").download(path);
        if (error || !blob) throw new Error("A completed reading is missing. Read the files again.");
        return extractionSchema.parse(JSON.parse(await blob.text()));
      };
      const pages = [];
      for (const path of data.pages) pages.push(await read(path));
      const promises = [];
      for (const path of data.priceList) promises.push(await read(path));
      const firstPromise = promises[0];
      if (!firstPromise) throw new Error("Promise reading is missing.");
      const promise = { ...firstPromise, agreed_items: promises.flatMap((p) => p.agreed_items) };
      const combined = combineInvoicePages(pages, promise);
      if (data.billType === "refund") { combined.promise_kind = "refund"; combined.refund = promises.find((p) => p.refund)?.refund ?? null; combined.agreed_items = []; }
      step = "Saving invoice check";
      const { saveExtraction } = await import("@/lib/extraction-storage.server");
      const saved = await saveExtraction(context.supabase, context.userId, data.bill.path, data.promise.path, data.billType, combined);
      const { error: usageError } = await context.supabase.from("ai_usage").update({ bill_id: saved.billId }).eq("user_id", context.userId).eq("reading_id", data.readingId);
      if (usageError) throw new Error("Couldn't attach AI token usage to the check.");
      await context.supabase.storage.from("documents").remove([...data.pages, ...data.priceList]);
      return { ok: true as const, billId: saved.billId };
    } catch (error) {
      return { ok: false as const, error: readingStepError(step, extractionErrorMessage(error)) };
    }
  });