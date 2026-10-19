import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Upload, FileCheck2, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { extractionErrorMessage, validateDocumentSize } from "@/lib/extraction-errors";
import { readInvoicePart, finishInvoiceReading } from "@/lib/invoice-reading.functions";
import { readingStepError } from "@/lib/invoice-extraction";
import { isDandyDocument } from "@/lib/dandy";

// Code-readable documents are handed over whole, so a line wrapped across a page break is never lost.
async function combinedText(batches: { file: File }[]) {
  if (!batches.length || batches.some((b) => b.file.type !== "text/plain")) return null;
  return (await Promise.all(batches.map((b) => b.file.text()))).join("\n");
}

export const Route = createFileRoute("/_authenticated/new")({
  head: () => ({
    meta: [
      { title: "New check — BillShield" },
      { name: "description", content: "Upload a bill and a promise to compare them." },
      { property: "og:title", content: "New check — BillShield" },
      { property: "og:description", content: "Upload a bill and a promise to compare them." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: NewCheck,
});

const ACCEPT = "application/pdf,image/png,image/jpeg,image/webp";

function Drop({ label, hint, file, onFile }: { label: string; hint: string; file: File | null; onFile: (f: File | null) => void }) {
  return (
    <label className="flex cursor-pointer flex-col gap-3 rounded-lg border-2 border-dashed border-input bg-card p-6 shadow-card transition-colors hover:border-accent">
      <span className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">{label}</span>
      <div className="flex items-center gap-3">
        {file ? <FileCheck2 className="h-6 w-6 text-success" /> : <Upload className="h-6 w-6 text-accent" />}
        <span className="truncate font-medium">{file ? file.name : "Choose image or PDF"}</span>
      </div>
      <span className="text-sm text-muted-foreground">{hint}</span>
      <input type="file" accept={ACCEPT} className="sr-only" onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
    </label>
  );
}

function NewCheck() {
  const navigate = useNavigate();
  const { user } = Route.useRouteContext();
  const readPart = useServerFn(readInvoicePart);
  const finishReading = useServerFn(finishInvoiceReading);
  const [bill, setBill] = useState<File | null>(null);
  const [promise, setPromise] = useState<File | null>(null);
  const [promiseMode, setPromiseMode] = useState<"document" | "typed">("document");
  const [typedPromise, setTypedPromise] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [billType, setBillType] = useState<"refund" | "lab_invoice">("refund");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function upload(f: File, kind: string): Promise<{ path: string; name: string; mime: "application/pdf" | "image/png" | "image/jpeg" | "image/webp" | "text/plain" }> {
    const mime = f.type;
    if (mime !== "application/pdf" && mime !== "image/png" && mime !== "image/jpeg" && mime !== "image/webp" && mime !== "text/plain") throw new Error("Unsupported file type.");
    const ext = f.name.split(".").pop() ?? "bin";
    const path = `${user.id}/${crypto.randomUUID()}-${kind}.${ext}`;
    const { error } = await supabase.storage.from("documents").upload(path, f, { contentType: f.type });
    if (error) throw error;
    return { path, name: f.name, mime };
  }

  async function start() {
    if (!bill || (promiseMode === "document" ? !promise : !typedPromise.trim())) return;
    setErrorMessage(null);
    let step = "Checking files";
    try {
      validateDocumentSize(bill.size);
      if (promiseMode === "document" && promise) validateDocumentSize(promise.size);
      step = "Uploading files";
      setBusy("Uploading privately…");
      const [b, p] = await Promise.all([upload(bill, "bill"), promiseMode === "document" && promise ? upload(promise, "promise") : Promise.resolve(undefined)]);
      const readingId = crypto.randomUUID();
      step = "Preparing document pages";
      setBusy("Preparing document pages…");
      const { prepareDocument } = await import("@/lib/document-pages");
      const pages: string[] = [];
      const pricePaths: string[] = [];
      const temporary: string[] = [];
      try {
        const promiseBatches = promiseMode === "document" && promise ? await prepareDocument(promise) : [];
        const promiseText = billType === "lab_invoice" ? await combinedText(promiseBatches) : null;
        if (p && promiseText && isDandyDocument(promiseText)) {
          step = "Reading price list with code";
          setBusy("Reading price list with code…");
          const file = await upload(new File([promiseText], "price-list.txt", { type: "text/plain" }), "promise-text"); temporary.push(file.path);
          const result = await readPart({ data: { file, sourcePath: p.path, part: "price_list", readingId } });
          if (!result.ok) throw new Error(result.error);
          pricePaths.push(result.cachePath);
        } else {
          for (const batch of promiseBatches) {
            step = `Reading promise page ${batch.first} of ${batch.total}`;
            setBusy(`${step}…`);
            const file = await upload(batch.file, "promise-batch"); temporary.push(file.path);
            const result = await readPart({ data: { file, sourcePath: p?.path, part: billType === "lab_invoice" ? "price_list" : "refund_promise", readingId } });
            if (!result.ok) throw new Error(result.error);
            pricePaths.push(result.cachePath);
          }
        }
        let previousOrder: string | null = null;
        const invoiceBatches = await prepareDocument(bill);
        const billText = billType === "lab_invoice" ? await combinedText(invoiceBatches) : null;
        if (billText && isDandyDocument(billText)) {
          step = "Reading invoice with code";
          setBusy("Reading invoice with code…");
          const file = await upload(new File([billText], "invoice.txt", { type: "text/plain" }), "bill-text"); temporary.push(file.path);
          const result = await readPart({ data: { file, part: "invoice", readingId } });
          if (!result.ok) throw new Error(result.error);
          pages.push(result.cachePath);
        } else {
          for (const batch of invoiceBatches) {
            step = `Reading page ${batch.first} of ${batch.total}`;
            setBusy(`${step}…`);
            const file = await upload(batch.file, "bill-batch"); temporary.push(file.path);
            const result = await readPart({ data: { file, part: billType === "lab_invoice" ? "invoice" : "bill", previousOrder, readingId } });
            if (!result.ok) throw new Error(result.error);
            pages.push(result.cachePath);
            previousOrder = result.lastOrder ?? previousOrder;
          }
        }
        step = "Combining and saving check";
        setBusy(promiseMode === "typed" ? "Reading the promise you entered…" : "Combining and saving check…");
        const result = await finishReading({ data: { bill: b, ...(p ? { promise: p } : { typedPromise }), pages, priceList: pricePaths, billType, readingId } });
        if (!result.ok) throw new Error(result.error);
        await navigate({ to: "/check/$billId", params: { billId: result.billId } });
      } finally {
        await supabase.storage.from("documents").remove([...temporary, ...pages, ...pricePaths]);
      }
    } catch (e) {
      const message = extractionErrorMessage(e);
      setErrorMessage(message.includes("Busy – try again in a minute") ? "Busy – try again in a minute" : readingStepError(step, message));
      setBusy(null);
    }
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-3xl font-bold">New check</h1>
<p className="mt-2 text-muted-foreground">Files are stored privately. Only you can see them.</p>
      <p className="mt-1 text-sm text-muted-foreground">Remove patient names before uploading.</p>
      <fieldset className="mt-6">
        <legend className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">Bill type</legend>
        <div className="mt-2 flex gap-2" role="radiogroup" aria-label="Bill type">
          {([["refund", "Refund"], ["lab_invoice", "Lab/vendor invoice"]] as const).map(([value, label]) => (
            <Button
              key={value}
              type="button"
              role="radio"
              aria-checked={billType === value}
              disabled={!!busy}
              onClick={() => setBillType(value)}
              className={`rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${billType === value ? "border-accent bg-accent/10 text-foreground" : "border-input bg-card text-muted-foreground hover:border-accent"}`}
            >
              {label}
            </Button>
          ))}
        </div>
      </fieldset>
      <div className="mt-8 grid gap-4 md:grid-cols-2">
        <Drop label="Bill" hint="Card statement or vendor invoice" file={bill} onFile={setBill} />
        <section className="min-w-0 space-y-3" aria-label="Promise">
          <h2 className="font-mono text-xs uppercase text-muted-foreground">Promise</h2>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Promise source">
            {([["document", "Upload a document"], ["typed", "Type what you were promised"]] as const).map(([value, label]) => <Button key={value} type="button" variant={promiseMode === value ? "secondary" : "outline"} size="sm" role="radio" aria-checked={promiseMode === value} disabled={!!busy} className="h-auto whitespace-normal text-left" onClick={() => setPromiseMode(value)}>{label}</Button>)}
          </div>
          {promiseMode === "document" ? <Drop label="Promise document" hint="Refund confirmation, contract or agreed price list" file={promise} onFile={setPromise} /> : <Textarea aria-label="Type what you were promised" value={typedPromise} maxLength={4000} disabled={!!busy} onChange={e => setTypedPromise(e.target.value)} placeholder="Plan is ₹499/month incl. 18% GST; Refund of ₹7,180 promised on call; Agreed crown price $75" className="min-h-40" />}
        </section>
      </div>
      <Button variant="signal" size="lg" className="mt-8 w-full md:w-auto" disabled={!bill || (promiseMode === "document" ? !promise : !typedPromise.trim()) || !!busy} onClick={start}>
        {busy ? (<><Loader2 className="h-4 w-4 animate-spin" /> {busy}</>) : promiseMode === "typed" ? "Read bill and promise" : "Read both files"}
      </Button>
      {busy && <p role="status" aria-live="polite" className="mt-3 text-sm text-muted-foreground">{busy}</p>}
      {errorMessage && <p role="alert" className="mt-4 text-sm text-destructive">{errorMessage}</p>}
    </main>
  );
}
