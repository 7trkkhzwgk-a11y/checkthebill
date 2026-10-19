import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export function usageSink(client: SupabaseClient<Database>, userId: string, step: string, ids: { billId?: string; readingId?: string }) {
  return async (tokens: number, model: string) => {
    const { error } = await client.from("ai_usage").insert({ user_id: userId, bill_id: ids.billId ?? null, reading_id: ids.readingId ?? null, step, model, tokens });
    if (error) throw new Error("Couldn't save AI token usage.");
    console.info("AI usage", { check: ids.billId ?? ids.readingId, step, model, tokens });
  };
}