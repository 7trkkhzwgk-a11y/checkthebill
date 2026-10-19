import { readFileSync } from "node:fs";
import { extractInvoicePart } from "./src/lib/extract.server";
const text = readFileSync("/tmp/inv1-2.txt", "utf8");
for (let i = 1; i <= 2; i++) {
  try {
    const out = await extractInvoicePart({ name: "invoice.txt", mime: "text/plain", text }, "invoice", null,
      async (tokens, model) => console.log(`2-page run ${i}: model=${model} tokens=${tokens}`));
    console.log(`2-page run ${i}: OK lines=${out.bill_lines.length} issuer=${out.issuer} subtotal=${out.orders_subtotal} tax=${out.sales_tax}`);
  } catch (e) {
    console.log(`2-page run ${i}: FAIL -> ${(e as Error).message.slice(0, 170)}`);
  }
}
