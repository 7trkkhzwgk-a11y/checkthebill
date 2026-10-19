import { afterEach, describe, expect, it, vi } from "vitest";
import { File as NodeFile } from "node:buffer";
import { PDFDocument } from "pdf-lib";
import { splitInvoicePdf } from "@/lib/pdf-pages";
import { combineInvoicePages, maskedExtraction, readingStepError } from "@/lib/invoice-extraction";
import type { Extraction } from "@/lib/extraction";

const empty: Extraction = { issuer: "Synthetic Lab", currency: "USD", source: null, bill_total: null, orders_subtotal: null, sales_tax: null, bill_lines: [], promise_kind: "price_list", refund: null, agreed_items: [] };
const item = { kind: "transaction" as const, description: "Synthetic crown", date: null, amount: 17, type: "charge" as const, reference_no: null, bank_ref: null, order_no: "SYN-ORDER-A", tax_amount: 2, total_amount: 19 };

describe("invoice page reading", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("splits a ten-page invoice into ten ordered one-page PDFs", async () => {
    vi.stubGlobal("File", NodeFile);
    const pdf = await PDFDocument.create();
    for (let i = 0; i < 10; i++) pdf.addPage([300 + i, 400]);
    const file = new File([new Uint8Array(await pdf.save())], "synthetic.pdf", { type: "application/pdf" });
    const pages = await splitInvoicePdf(file);
    expect(pages).toHaveLength(10);
    for (const [i, page] of pages.entries()) {
      const read = await PDFDocument.load(await page.arrayBuffer());
      expect(read.getPageCount()).toBe(1);
      expect(read.getPage(0).getWidth()).toBe(300 + i);
    }
  });
  it("combines all lines without summing repeated printed totals or dropping identical items", () => {
    const priceList = { ...empty, source: "Synthetic Contract", agreed_items: [{ item: "Synthetic crown", promised_amount: 17, original_charge: null, reference_no: null, transaction_id: null, bank_ref: null, promised_on: null, status_text: null }] };
    const pages = Array.from({ length: 10 }, () => ({ ...empty, bill_total: 190, orders_subtotal: 170, sales_tax: 20, bill_lines: [item] }));
    const combined = combineInvoicePages(pages, priceList);
    expect(combined.bill_lines).toHaveLength(10);
    expect(combined.bill_lines.every((line) => line.order_no === "SYN-ORDER-A" && line.tax_amount === 2)).toBe(true);
    expect(combined).toMatchObject({ bill_total: 190, orders_subtotal: 170, sales_tax: 20, source: "Synthetic Contract", agreed_items: [expect.objectContaining({ promised_amount: 17 })] });
  });
  it("doesn't invent missing totals and rejects conflicting printed totals", () => {
    expect(combineInvoicePages([empty], empty).bill_total).toBeNull();
    expect(() => combineInvoicePages([{ ...empty, bill_total: 190 }, { ...empty, bill_total: 191 }], empty)).toThrow("Conflicting printed bill total");
  });
  it("masks intermediate sensitive numbers while keeping full order references", () => {
    const masked = maskedExtraction({ ...empty, bill_lines: [{ ...item, description: "[NAME] crown; phone 555-010-1234" }] });
    expect(masked.bill_lines[0]?.description).not.toContain("555-010-1234");
    expect(masked.bill_lines[0]?.order_no).toBe("SYN-ORDER-A");
  });
  it("names the failing page when hosting returns a generic error", () => {
    expect(readingStepError("Reading page 3 of 10", "Internal server error")).toContain("Reading page 3 of 10 failed: Document reading reached a processing limit");
  });
});