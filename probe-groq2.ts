import { readFileSync } from "node:fs";
import { zodSchema } from "ai";
import { extractionOutputSchema } from "./src/lib/extraction";
import { groqCompletion } from "./src/lib/ai/groq.server";
import { TEXT_MODEL, VISION_MODEL } from "./src/lib/ai/groq-policy";

const schema = await zodSchema(extractionOutputSchema).jsonSchema;
const schemaJson = JSON.stringify(schema);
console.log("schema chars:", schemaJson.length);

const text = readFileSync("/tmp/inv1-4.txt", "utf8");
const mode = "This is one ordered batch of BILL invoice pages. Extract only these pages.";
for (const model of [VISION_MODEL, TEXT_MODEL]) {
  try {
    const out = await groqCompletion(process.env.GROQ_API_KEY!, model,
      `${mode} Return only JSON exactly matching this schema: ${schemaJson}`, text, true);
    const parsed = JSON.parse(out);
    console.log(`${model}: OK lines=${parsed.bill_lines?.length} chars=${out.length}`);
  } catch (e) {
    console.log(`${model}: FAIL ${(e as Error).message.slice(0, 160)}`);
  }
}
