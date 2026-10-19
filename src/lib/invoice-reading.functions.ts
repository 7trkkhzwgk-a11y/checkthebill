import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { extractionSchema } from "@/lib/extraction";
import { extractionErrorMessage } from "@/lib/extraction-errors";
import { combineInvoicePages, maskedExtraction, readingStepError } from "@/lib/invoice-extraction";
import { z } from "zod";

const documentSchema = z.object({ path: z.string().min(1), name: z.string(), mime: z.enum(["application/pdf", "image/png", "image/jpeg", "image/webp"]) });
const partSchema = z.object({ file: documentSchema, part: z.enum(["invoice", "price_list"]), previousOrder: z.string().nullable().optional() });
const CACHE_VERSION = "v1";

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
      if (data.part === "price_list") {
        const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(file.base64));
        const hash = Array.from(new Uint8Array(digest), (v) => v.toString(16).padStart(2, "0")).join("");
        cachePath = `${context.userId}/price-list-cache/${CACHE_VERSION}-${hash}.json`;
        const cached = await context.supabase.storage.from("documents").download(cachePath);
        if (cached.data) {
          const parsed = extractionSchema.safeParse(JSON.parse(await cached.data.text()));
          if (parsed.success && parsed.data.promise_kind !== "refund") return { ok: true as const, cachePath, lastOrder: null, cached: true };
        }
      }
      const output = maskedExtraction(await extractInvoicePart(file, data.part, data.previousOrder ?? null));
      const { error } = await context.supabase.storage.from("documents").upload(cachePath, new Blob([JSON.stringify(output)], { type: "application/json" }), { contentType: "application/json", upsert: true });
      if (error) throw new Error("Couldn't save the privately cached reading.");
      return { ok: true as const, cachePath, lastOrder: output.bill_lines.at(-1)?.order_no ?? null, cached: false };
    } catch (error) {
      const message = readingStepError(step, extractionErrorMessage(error));
      console.error("Invoice reading step failed", { step, message });
      return { ok: false as const, error: message };
    }
  });

const finishSchema = z.object({ bill: documentSchema, promise: documentSchema, pages: z.array(z.string()).min(1), priceList: z.string() });
export const finishInvoiceReading = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.infer<typeof finishSchema>) => finishSchema.parse(input))
  .handler(async ({ data, context }) => {
    let step = "Combining invoice pages";
    try {
      for (const path of [data.bill.path, data.promise.path, data.priceList, ...data.pages]) ownPath(path, context.userId);
      if (new Set(data.pages).size !== data.pages.length) throw new Error("An invoice page was supplied twice.");
      const read = async (path: string) => {
        const { data: blob, error } = await context.supabase.storage.from("documents").download(path);
        if (error || !blob) throw new Error("A completed reading is missing. Read the files again.");
        return extractionSchema.parse(JSON.parse(await blob.text()));
      };
      const pages = [];
      for (const path of data.pages) pages.push(await read(path));
      const combined = combineInvoicePages(pages, await read(data.priceList));
      step = "Saving invoice check";
      const { saveExtraction } = await import("@/lib/extraction-storage.server");
      const saved = await saveExtraction(context.supabase, context.userId, data.bill.path, data.promise.path, "lab_invoice", combined);
      await context.supabase.storage.from("documents").remove(data.pages);
      return { ok: true as const, billId: saved.billId };
    } catch (error) {
      return { ok: false as const, error: readingStepError(step, extractionErrorMessage(error)) };
    }
  });