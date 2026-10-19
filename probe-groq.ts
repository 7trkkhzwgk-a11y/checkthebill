import { readFileSync } from "node:fs";
import { extractInvoicePart } from "./src/lib/extract.server";
const text = readFileSync("/tmp/inv1-4.txt", "utf8");
try {
  const out = await extractInvoicePart({ name: "invoice.txt", mime: "text/plain", text }, "invoice");
  console.log("OK lines:", out.bill_lines.length, "issuer:", out.issuer, "orders_subtotal:", out.orders_subtotal, "sales_tax:", out.sales_tax);
} catch (e) {
  console.log("RAW ERROR:", (e as Error).message.slice(0, 400));
}
