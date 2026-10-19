import { extractionSchema, normalizeExtraction, type Extraction } from "@/lib/extraction";

export function maskedExtraction(input: Extraction): Extraction {
  const n = normalizeExtraction(extractionSchema.parse(input));
  return {
    currency: n.currency, issuer: n.issuer, source: n.source,
    bill_total: n.bill_total, orders_subtotal: n.orders_subtotal, sales_tax: n.sales_tax,
    bill_lines: n.bill_lines.map((l) => ({ kind: "transaction", ...l })),
    promise_kind: n.promise_kind,
    refund: n.promise_kind === "refund" ? n.promise_rows[0] ?? null : null,
    agreed_items: n.promise_kind === "refund" ? [] : n.promise_rows,
  };
}

export function combineInvoicePages(pages: Extraction[], priceList: Extraction): Extraction {
  if (!pages.length) throw new Error("No invoice pages were read.");
  function printed(field: "bill_total" | "orders_subtotal" | "sales_tax") {
    const values = pages.map((p) => p[field]).filter((v): v is number => v != null);
    if (new Set(values).size > 1) throw new Error(`Conflicting printed ${field.replaceAll("_", " ")} across invoice pages. Check the original invoice.`);
    return values[0] ?? null;
  }
  return maskedExtraction({
    currency: pages.find((p) => p.currency)?.currency ?? priceList.currency ?? null,
    issuer: pages.find((p) => p.issuer)?.issuer ?? null,
    source: priceList.source, promise_kind: priceList.promise_kind,
    refund: null, agreed_items: priceList.agreed_items,
    bill_total: printed("bill_total"), orders_subtotal: printed("orders_subtotal"), sales_tax: printed("sales_tax"),
    bill_lines: pages.flatMap((p) => p.bill_lines),
  });
}

export function readingStepError(step: string, message: string) {
  const generic = /internal server error|HTTPError|failed to fetch|networkerror|worker exceeded|502|504/i.test(message);
  return `${step} failed: ${generic ? "Document reading reached a processing limit or lost its connection. Please start a fresh attempt; your files have not been confirmed." : message}`;
}