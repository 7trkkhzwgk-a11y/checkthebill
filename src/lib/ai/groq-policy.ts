// Models this account can reach: text-only batches use gpt-oss-120b; images (scans, screenshots) use qwen3.8-27b.
export const TEXT_MODEL = "openai/gpt-oss-120b";
export const VISION_MODEL = "qwen/qwen3.8-27b";
export function groqModelFor(content: { type: string }[]) {
  return content.some((part) => part.type === "image_url") ? VISION_MODEL : TEXT_MODEL;
}
export const GROQ_MAX_RETRIES = 3;
export function groqRetryDelay(retry: number, header: string | null) {
  const seconds = header == null ? NaN : Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.max(1000, seconds * 1000);
  const date = header ? Date.parse(header) : NaN;
  if (Number.isFinite(date)) return Math.max(1000, date - Date.now());
  return Math.min(60000, 10000 * 2 ** retry);
}