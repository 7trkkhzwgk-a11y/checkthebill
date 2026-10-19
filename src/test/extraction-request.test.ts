import { beforeEach, describe, expect, it, vi } from "vitest";
import { zodSchema } from "ai";
import { extractionOutputSchema } from "@/lib/extraction";
import { extractionErrorMessage, MAX_DOCUMENT_BYTES, validateDocumentSize } from "@/lib/extraction-errors";

const mock = vi.hoisted(() => ({ completion: vi.fn() }));
vi.mock("@/lib/ai/groq.server", () => ({ groqCompletion: mock.completion }));
import { extractLines, extractInvoicePart, EXTRACTION_INSTRUCTION } from "@/lib/extract.server";
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("GROQ_API_KEY", "test-only"); });
const complete = { currency: "USD", issuer: "Synthetic Lab", source: "Synthetic Contract", bill_total: 190, orders_subtotal: null, sales_tax: null, bill_lines: [], promise_kind: "price_list", refund: null, agreed_items: [] };

describe("complete extraction request", () => {
  it("requires every AI output property, including nullable currency and PNR", async () => {
    const schema = await zodSchema(extractionOutputSchema).jsonSchema;
    function verify(node: unknown) {
      if (!node || typeof node !== "object") return;
      const object = node as Record<string, unknown>;
      if (object["type"] === "object") {
        expect(object["additionalProperties"]).toBe(false);
        expect(object["required"]).toEqual(expect.arrayContaining(Object.keys(object["properties"] as object)));
      }
      for (const child of Object.values(object)) {
        if (Array.isArray(child)) child.forEach(verify); else verify(child);
      }
    }
    verify(schema);
    expect(schema.required).toContain("currency");
    expect(extractionOutputSchema.shape.refund.unwrap().shape.pnr.isOptional()).toBe(false);
    expect(extractionOutputSchema.shape.refund.unwrap().shape.pnr.isNullable()).toBe(true);
  });

  it("sends image data to the vision model and code-extracted PDF text to the text model, never raw PDFs", async () => {
    mock.completion.mockResolvedValue(JSON.stringify(complete));
    expect(await extractLines({ name: "bill.png", mime: "image/png", base64: "aW1hZ2U=" }, { name: "promise.txt", mime: "text/plain", text: "Synthetic contract text" })).toEqual(complete);
    const call = mock.completion.mock.calls[0];
    expect(call?.[1]).toBe("qwen/qwen3.8-27b");
    expect(call?.[2]).toContain(EXTRACTION_INSTRUCTION);
    expect(call?.[3][1]).toEqual({ type: "image_url", image_url: { url: "data:image/png;base64,aW1hZ2U=" } });
    expect(call?.[3][3]).toEqual({ type: "text", text: "Synthetic contract text" });
    mock.completion.mockResolvedValue(JSON.stringify(complete));
    await extractLines({ name: "bill.txt", mime: "text/plain", text: "Synthetic statement text" }, { name: "promise.txt", mime: "text/plain", text: "Synthetic contract text" });
    expect(mock.completion.mock.calls[1]?.[1]).toBe("openai/gpt-oss-120b");
  });
  it("does not hide exhausted rate limits behind JSON validation", async () => {
    mock.completion.mockRejectedValue(new Error("Busy – try again in a minute"));
    await expect(extractInvoicePart({ name: "b.txt", mime: "text/plain", text: "Synthetic" }, "invoice")).rejects.toThrow("Busy – try again in a minute");
  });
  it("reads price lists separately and passes continued-order context", async () => {
    mock.completion.mockResolvedValue(JSON.stringify(complete));
    const file = { name: "synthetic.txt", mime: "text/plain", text: "Synthetic" };
    await extractInvoicePart(file, "price_list");
    expect(mock.completion.mock.calls[0]?.[2]).toContain("only the PROMISE price list/contract");
    await extractInvoicePart(file, "invoice", "SYN-ORDER-A");
    expect(mock.completion.mock.calls[1]?.[2]).toContain('"SYN-ORDER-A"');
  });
  it("rejects malformed structuring without retrying", async () => {
    mock.completion.mockResolvedValue('{"bill_lines":[]}');
    await expect(extractInvoicePart({ name: "synthetic.txt", mime: "text/plain", text: "Synthetic" }, "invoice")).rejects.toThrow("incomplete or invalid");
    expect(mock.completion).toHaveBeenCalledTimes(1);
  });

});

describe("extraction errors", () => {
  it("preserves the safe 402 credit remedy", () => {
    expect(extractionErrorMessage({ statusCode: 402, responseBody: JSON.stringify({ message: "Add credits in Settings → Plans & credits." }) })).toBe("Add credits in Settings → Plans & credits.");
  });
  it("reports rate limits through nested causes", () => {
    expect(extractionErrorMessage({ message: "No output generated", cause: { statusCode: 429 } })).toContain("rate limited");
  });
  it("reports oversized uploads and upstream 413", () => {
    expect(() => validateDocumentSize(MAX_DOCUMENT_BYTES + 1)).toThrow("File too large");
    expect(() => validateDocumentSize(MAX_DOCUMENT_BYTES)).not.toThrow();
    expect(extractionErrorMessage({ statusCode: 413 })).toContain("File too large");
  });
});