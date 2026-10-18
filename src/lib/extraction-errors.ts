export const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;

export function validateDocumentSize(size: number) {
  if (size > MAX_DOCUMENT_BYTES) throw new Error("File too large. Choose an image or PDF smaller than 20 MB.");
  if (size === 0) throw new Error("This file is empty. Choose an image or PDF with content.");
}

export function extractionErrorMessage(error: unknown): string {
  const visited = new Set<unknown>();
  let current = error;
  while (current && typeof current === "object" && !visited.has(current)) {
    visited.add(current);
    const entry = current as { statusCode?: number; status?: number; message?: string; responseBody?: string; cause?: unknown };
    const status = entry.statusCode ?? entry.status;
    let safeMessage: string | undefined;
    if (entry.responseBody) {
      try {
        const body = JSON.parse(entry.responseBody);
        safeMessage = typeof body.message === "string" ? body.message : typeof body.error?.message === "string" ? body.error.message : undefined;
      } catch { /* A non-JSON error body is never shown. */ }
    }
    if (status === 429) return "Document reading is temporarily rate limited. Please wait a moment, then try again.";
    if (status === 402) return safeMessage ?? "Not enough AI credits to read these files. Add credits in Settings → Plans & credits, then try again.";
    if (status === 413 || /file too large|payload too large|request too large|maximum.*(?:file|size)|file.*(?:size limit|too big)/i.test(entry.message ?? "")) return "File too large. Choose an image or PDF smaller than 20 MB.";
    if (status === 401) return "Document reading is not configured correctly. Please contact the app owner.";
    if (status === 403) return safeMessage ?? "Document reading is blocked by the AI service. Please contact the app owner to restore access.";
    if (status === 404) return "The document-reading service is unavailable. Please try again when service is restored.";
    if (status === 400) return "The AI service could not accept these files. Please try a supported image or PDF; if this continues, contact the app owner.";
    if (status && status >= 500) return "The document-reading service is temporarily unavailable. Please try again later.";
    if (entry.cause) { current = entry.cause; continue; }
    if (/no output generated|no object generated/i.test(entry.message ?? "")) return "The AI service returned no readable document data. Please try clearer images or PDFs.";
    return entry.message || "Couldn't read the documents. Please try again.";
  }
  return "Couldn't read the documents. Please try again.";
}