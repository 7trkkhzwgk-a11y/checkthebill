export const READING_MODEL = "meta-llama/llama-4-scout-17b-16e-instruct";
export const WRITING_MODEL = "llama-3.3-70b-versatile";
export const GROQ_MAX_RETRIES = 3;
export function groqRetryDelay(retry: number, header: string | null) {
  const seconds = header == null ? NaN : Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.max(1000, seconds * 1000);
  const date = header ? Date.parse(header) : NaN;
  if (Number.isFinite(date)) return Math.max(1000, date - Date.now());
  return Math.min(60000, 10000 * 2 ** retry);
}