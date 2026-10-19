import { readFileSync } from "node:fs";
import { extractInvoicePart } from "./src/lib/extract.server";
const text = readFileSync("/tmp/inv1-4.txt", "utf8");
for (let i = 1; i <= 3; i++) {
  const started = Date.now();
  try {
    const out = await extractInvoicePart({ name: "invoice.txt", mime: "text/plain", text }, "invoice", null,
      async (tokens, model) => console.log(`run ${i}: model=${model} tokens=${tokens}`));
    console.log(`run ${i}: OK lines=${out.bill_lines.length} in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  } catch (e) {
    console.log(`run ${i}: FAIL in ${((Date.now() - started) / 1000).toFixed(1)}s -> ${(e as Error).message.slice(0, 200)}`);
  }
}
