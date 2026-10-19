import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
// Old browser tabs must reopen New check rather than send raw PDFs to Groq.
export const runExtraction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => input)
  .handler(async () => { throw new Error("Document reading has been updated. Reload New check to prepare PDF text and scanned images."); });
