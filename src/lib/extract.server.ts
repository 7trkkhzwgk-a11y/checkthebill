import { createOpenAI } from "@ai-sdk/openai";
import { streamText, Output, NoObjectGeneratedError } from "ai";
import { z } from "zod";

export const EXTRACTION_INSTRUCTION =
  "Extract every line as structured data only: date, description, amount, type (charge/credit), reference numbers, bank reference. Do not calculate anything.";

const PRIVACY_RULES =
  "Privacy: replace any personal name or patient name with [NAME], any street/postal address with [ADDRESS], any phone number with [PHONE]. Show card or account numbers only as their last 4 digits (e.g. •••• 1234). Copy amounts exactly as printed as positive numbers; never add, subtract, total or infer values. Dates as YYYY-MM-DD when determinable, otherwise null. Use null for anything not printed.";

const line = z.object({
  date: z.string().nullable(),
  description: z.string().nullable(),
  amount: z.number().nullable(),
  type: z.enum(["charge", "credit"]).nullable(),
  reference_no: z.string().nullable(),
  bank_ref: z.string().nullable(),
});

export const extractionSchema = z.object({
  issuer: z.string().nullable(),
  source: z.string().nullable(),
  bill_lines: z.array(line),
  promise_lines: z.array(line),
});
export type Extraction = z.infer<typeof extractionSchema>;

export type InFile = { name: string; mime: string; base64: string };

function filePart(f: InFile) {
  if (f.mime === "application/pdf") {
    return { type: "file" as const, filename: f.name, data: f.base64, mediaType: "application/pdf" };
  }
  return { type: "image" as const, image: new URL(`data:${f.mime};base64,${f.base64}`) };
}

export async function extractLines(bill: InFile, promise: InFile): Promise<Extraction> {
  const apiKey = process.env["LOVABLE_API_KEY"];
  if (!apiKey) throw new Error("AI is not configured.");
  const provider = createOpenAI({
    baseURL: "https://ai.gateway.lovable.dev/v1",
    apiKey,
    headers: { "Lovable-API-Key": apiKey, "X-Lovable-AIG-SDK": "vercel-ai-sdk" },
  });

  const result = streamText({
    model: provider.responses("openai/gpt-6-astra"),
    instructions: `${EXTRACTION_INSTRUCTION}\n\n${PRIVACY_RULES}\n\nThe first file is the BILL (card statement or vendor invoice): put its lines in bill_lines and its issuer name (a business, not a person) in issuer. The second file is the PROMISE (refund confirmation, contract or agreed price list): put its lines in promise_lines and a short label for the document in source.`,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "BILL file:" },
          filePart(bill),
          { type: "text", text: "PROMISE file:" },
          filePart(promise),
        ],
      },
    ],
    output: Output.object({ schema: extractionSchema }),
    providerOptions: {
      openai: {
        forceReasoning: true,
        reasoningEffort: "low",
        reasoningSummary: "auto",
        store: false,
        include: ["reasoning.encrypted_content"],
      },
    },
  });

  try {
    return await result.output;
  } catch (e) {
    if (NoObjectGeneratedError.isInstance(e)) {
      throw new Error("Couldn't read the documents. Try clearer files.");
    }
    throw e;
  }
}
