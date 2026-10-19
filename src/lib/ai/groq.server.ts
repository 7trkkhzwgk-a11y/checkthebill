import { GROQ_MAX_RETRIES, groqRetryDelay } from "@/lib/ai/groq-policy";

export type GroqPart = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };
export type UsageSink = (tokens: number, model: string) => Promise<void>;

export async function groqCompletion(apiKey: string, model: string, instructions: string, content: string | GroqPart[], json = false, usage?: UsageSink) {
  if (!apiKey) throw new Error("Groq is not configured. The app owner needs to add GROQ_API_KEY securely.");
  for (let attempt = 0; attempt <= GROQ_MAX_RETRIES; attempt++) {
    let response: Response;
    try { response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, stream: false, messages: [{ role: "system", content: instructions }, { role: "user", content }], ...(json ? { response_format: { type: "json_object" } } : {}) }),
    }); } catch {
      throw new Error("Couldn't connect to Groq. Check the GROQ_API_KEY in the secure secret form and try again.");
    }
    if (response.status === 429) {
      await response.body?.cancel();
      if (attempt === GROQ_MAX_RETRIES) throw new Error("Busy – try again in a minute");
      await new Promise((resolve) => setTimeout(resolve, groqRetryDelay(attempt, response.headers.get("retry-after"))));
      continue;
    }
    const body = await response.json() as { error?: { message?: string }; choices?: { finish_reason?: string; message?: { content?: string; refusal?: string } }[]; usage?: { total_tokens?: number } };
    if (!response.ok) {
      // No response bodies, keys or document content are logged.
      console.error("Groq request failed", { status: response.status, model });
      if (response.status === 401) throw new Error("Groq rejected the API key. The app owner needs to update GROQ_API_KEY securely.");
      throw new Error(body.error?.message ?? `Groq returned error ${response.status}.`);
    }
    const tokens = body.usage?.total_tokens ?? 0;
    if (usage) await usage(tokens, model);
    const answer = body.choices?.[0];
    if (answer?.message?.refusal || answer?.finish_reason === "content_filter") throw new Error("Groq declined this request.");
    if (answer?.finish_reason === "length") throw new Error("Groq could not finish this reading. Use a smaller document batch.");
    const text = answer?.message?.content?.trim();
    if (!text) throw new Error("Groq returned no readable answer.");
    return text;
  }
  throw new Error("Busy – try again in a minute");
}