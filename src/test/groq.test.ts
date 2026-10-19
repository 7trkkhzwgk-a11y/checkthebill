import { afterEach, describe, expect, it, vi } from "vitest";
import { groqCompletion } from "@/lib/ai/groq.server";
import { GROQ_MODEL } from "@/lib/ai/groq-policy";

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
describe("Groq request policy", () => {
  it("uses the account's model, keeps one complete answer and records actual reported tokens", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: "Synthetic answer" } }], usage: { total_tokens: 37 } })));
    vi.stubGlobal("fetch", fetch);
    const usage = vi.fn();
    expect(await groqCompletion("test-only", GROQ_MODEL, "Facts only", "Synthetic question", false, usage)).toBe("Synthetic answer");
    const sent = JSON.parse(fetch.mock.calls[0]?.[1].body);
    expect(sent.model).toBe("qwen/qwen3.8-27b");
    expect(sent.max_tokens).toBe(16000);
    expect(sent.reasoning_effort).toBe("low");
    expect(sent.stream).toBe(false);
    expect(usage).toHaveBeenCalledWith(37, GROQ_MODEL);
  });
  it("waits and retries 429 up to three times, then stops with Busy", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn().mockImplementation(async () => new Response("{}", { status: 429, headers: { "Retry-After": "1" } }));
    vi.stubGlobal("fetch", fetch);
    const result = expect(groqCompletion("test-only", GROQ_MODEL, "JSON", "Synthetic", true)).rejects.toThrow("Busy – try again in a minute");
    await vi.runAllTimersAsync();
    await result;
    expect(fetch).toHaveBeenCalledTimes(4);
  });
  it("does not retry provider denials or substitute the requested model", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: "Access denied" } }), { status: 403 }));
    vi.stubGlobal("fetch", fetch);
    await expect(groqCompletion("test-only", GROQ_MODEL, "JSON", "Synthetic", true)).rejects.toThrow("Access denied");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetch.mock.calls[0]?.[1].body).model).toBe("qwen/qwen3.8-27b");
  });
});
