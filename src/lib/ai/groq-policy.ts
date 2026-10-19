// One model for every AI call: this key's gpt-oss-120b cap (8,000 tokens/minute) rejects a single 4-page invoice batch (11,997 tokens).
export const GROQ_MODEL = "qwen/qwen3.8-27b";
// A full price list needs more answer room than the default budget, which truncates the JSON.
export const GROQ_MAX_TOKENS = 16000;
export const GROQ_REASONING_EFFORT = "low";
export const GROQ_MAX_RETRIES = 3;
export function groqRetryDelay(retry: number, header: string | null) {
  const seconds = header == null ? NaN : Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.max(1000, seconds * 1000);
  const date = header ? Date.parse(header) : NaN;
  if (Number.isFinite(date)) return Math.max(1000, date - Date.now());
  return Math.min(60000, 10000 * 2 ** retry);
}
