import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

export type ReadingBatch = { file: File; first: number; last: number; total: number };

// Imported only from the upload event. Text extraction and rendering are local code, not AI.
export async function prepareDocument(file: File): Promise<ReadingBatch[]> {
  if (file.type !== "application/pdf") return [{ file, first: 1, last: 1, total: 1 }];
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const pdf = await task.promise;
  const batches: ReadingBatch[] = [];
  let texts: string[] = [];
  let first = 1;
  const flush = () => {
    if (!texts.length) return;
    const last = first + texts.length - 1;
    batches.push({ file: new File([texts.join("\n\n")], `pages-${first}-${last}.txt`, { type: "text/plain" }), first, last, total: pdf.numPages });
    texts = [];
  };
  try {
    for (let index = 1; index <= pdf.numPages; index++) {
      const page = await pdf.getPage(index);
      const layer = await page.getTextContent();
      const text = layer.items.map((item) => "str" in item ? `${item.str}${item.hasEOL ? "\n" : " "}` : "").join("");
      if (text.trim().length) {
        if (!texts.length) first = index;
        texts.push(`PAGE ${index} OF ${pdf.numPages}\n${text}`);
        if (texts.length === 4) flush();
      } else {
        flush();
        const viewport = page.getViewport({ scale: 1.8 });
        const canvas = document.createElement("canvas");
        canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("Couldn't render the scanned PDF page.");
        await page.render({ canvas, canvasContext: ctx, viewport }).promise;
        const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Couldn't prepare scanned page.")), "image/jpeg", 0.9));
        batches.push({ file: new File([blob], `scan-page-${index}.jpg`, { type: "image/jpeg" }), first: index, last: index, total: pdf.numPages });
        canvas.width = 0; canvas.height = 0;
      }
      page.cleanup();
    }
    flush();
    if (!batches.length) throw new Error("This PDF has no pages.");
    return batches;
  } finally { await task.destroy(); }
}