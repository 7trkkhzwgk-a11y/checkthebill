import { beforeEach, describe, expect, it, vi } from "vitest";
import { zodSchema } from "ai";
import { extractionOutputSchema } from "@/lib/extraction";
import { extractionErrorMessage, MAX_DOCUMENT_BYTES, validateDocumentSize } from "@/lib/extraction-errors";

const mock = vi.hoisted(() => ({ streamText: vi.fn(), responses: vi.fn(() => "model") }));
vi.mock("ai", async (original) => ({ ...await original<typeof import("ai")>(), streamText: mock.streamText }));
vi.mock("@ai-sdk/openai", () => ({ createOpenAI: () => ({ responses: mock.responses }) }));
import { extractLines, extractInvoicePart, EXTRACTION_INSTRUCTION } from "@/lib/extract.server";

beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("LOVABLE_API_KEY", "test-only"); });

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

  it("includes both image and PDF bytes and existing instructions, returning only completed data", async () => {
    const complete = { currency: "INR", issuer: "Rail", source: "Rail", bill_total: 7475.4, bill_lines: [], promise_kind: "refund", refund: null, agreed_items: [] };
    let consumed = false;
    mock.streamText.mockImplementation(() => ({
      consumeStream: async () => { consumed = true; },
      get output() { expect(consumed).toBe(true); return Promise.resolve(complete); },
    }));
    const result = await extractLines({ name: "bill.png", mime: "image/png", base64: "aW1hZ2U=" }, { name: "promise.pdf", mime: "application/pdf", base64: "cGRm" });
    expect(result).toEqual(complete);
    const call = mock.streamText.mock.calls[0]?.[0];
    expect(call.instructions).toContain(EXTRACTION_INSTRUCTION);
    expect(call.messages[0].content[1].image.href).toBe("data:image/png;base64,aW1hZ2U=");
    expect(call.messages[0].content[3]).toEqual({ type: "file", filename: "promise.pdf", data: "cGRm", mediaType: "application/pdf" });
  });

  it("surfaces the upstream 429 instead of an empty-output validation error", async () => {
    mock.streamText.mockImplementation((options) => ({
      consumeStream: async () => { options.onError({ error: { statusCode: 429, message: "rate limited" } }); },
      get output() { throw new Error("No output generated. Check the stream for errors."); },
    }));
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(extractLines({ name: "b.png", mime: "image/png", base64: "Yg==" }, { name: "p.png", mime: "image/png", base64: "cA==" })).rejects.toThrow("temporarily rate limited");
    expect(mock.streamText.mock.calls[0]?.[0].maxRetries).toBe(0);
    vi.restoreAllMocks();
  });

  it("reads the price list separately and preserves the final order context for a continued invoice page", async () => {
    mock.streamText.mockImplementation(() => ({ consumeStream: async () => {}, output: Promise.resolve({}) }));
    const file = { name: "synthetic.pdf", mime: "application/pdf", base64: "cGRm" };
    await extractInvoicePart(file, "price_list");
    const price = mock.streamText.mock.calls[0]?.[0];
    expect(price.messages[0].content.filter((p: { type: string }) => p.type === "file")).toHaveLength(1);
    expect(price.instructions).toContain("only the PROMISE contract/price list");
    await extractInvoicePart(file, "invoice", "SYN-ORDER-A");
    const invoice = mock.streamText.mock.calls[1]?.[0];
    expect(invoice.instructions).toContain('"SYN-ORDER-A"');
    expect(invoice.instructions).toContain(EXTRACTION_INSTRUCTION);
    expect(invoice.maxRetries).toBe(0);
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