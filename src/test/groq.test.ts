import { afterEach, describe, expect, it, vi } from "vitest";
import { groqCompletion } from "@/lib/ai/groq.server";
import { TEXT_MODEL, VISION_MODEL, groqModelFor } from "@/lib/ai/groq-policy";

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
describe("Groq request policy", () => {
  it("uses the text model for writing and records actual reported tokens", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: "Synthetic answer" } }], usage: { total_tokens: 37 } })));
    vi.stubGlobal("fetch", fetch);
    const usage = vi.fn();
    expect(await groqCompletion("test-only", TEXT_MODEL, "Facts only", "Synthetic question", false, usage)).toBe("Synthetic answer");
    const sent = JSON.parse(fetch.mock.calls[0]?.[1].body);
    expect(sent.model).toBe("openai/gpt-oss-120b");
    expect(sent.max_tokens).toBe(16000);
    expect(sent.reasoning_effort).toBe("low");
    expect(sent.stream).toBe(false);
    expect(usage).toHaveBeenCalledWith(37, TEXT_MODEL);
  });
  it("sends images to the vision model and text-only batches to the text model", () => {
    expect(groqModelFor([{ type: "text", text: "BILL:" }, { type: "image_url", image_url: { url: "data:image/png;base64,aW1hZ2U=" } }])).toBe(VISION_MODEL);
    expect(groqModelFor([{ type: "text", text: "BILL:" }, { type: "text", text: "Synthetic printed text" }])).toBe(TEXT_MODEL);
    expect(VISION_MODEL).toBe("qwen/qwen3.8-27b");
    expect(TEXT_MODEL).toBe("openai/gpt-oss-120b");
  });
  it("waits and retries 429 up to three times, then stops with Busy", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn().mockImplementation(async () => new Response("{}", { status: 429, headers: { "Retry-After": "1" } }));
    vi.stubGlobal("fetch", fetch);
    const result = expect(groqCompletion("test-only", TEXT_MODEL, "JSON", "Synthetic", true)).rejects.toThrow("Busy – try again in a minute");
    await vi.runAllTimersAsync();
    await result;
    expect(fetch).toHaveBeenCalledTimes(4);
  });
  it("does not retry provider denials or substitute the requested model", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: "Access denied" } }), { status: 403 }));
    vi.stubGlobal("fetch", fetch);
    await expect(groqCompletion("test-only", VISION_MODEL, "JSON", "Synthetic", true)).rejects.toThrow("Access denied");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetch.mock.calls[0]?.[1].body).model).toBe("qwen/qwen3.8-27b");
  });
});
