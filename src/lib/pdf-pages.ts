import { PDFDocument } from "pdf-lib";

// Local file manipulation only. No document interpretation or AI runs here.
export async function splitInvoicePdf(file: File): Promise<File[]> {
  if (file.type !== "application/pdf") return [file];
  const source = await PDFDocument.load(await file.arrayBuffer());
  const files: File[] = [];
  for (const index of source.getPageIndices()) {
    const page = await PDFDocument.create();
    const copied = await page.copyPages(source, [index]);
    for (const p of copied) page.addPage(p);
    const bytes = await page.save();
    files.push(new File([new Uint8Array(bytes)], `invoice-page-${index + 1}.pdf`, { type: "application/pdf" }));
  }
  if (!files.length) throw new Error("The invoice PDF has no pages.");
  return files;
}