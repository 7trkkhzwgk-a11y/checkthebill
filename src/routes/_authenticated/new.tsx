import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Upload, FileCheck2, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { runExtraction } from "@/lib/checks.functions";
import { Button } from "@/components/ui/button";
import { extractionErrorMessage, validateDocumentSize } from "@/lib/extraction-errors";
import { readInvoicePart, finishInvoiceReading } from "@/lib/invoice-reading.functions";
import { readingStepError } from "@/lib/invoice-extraction";

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
  const extract = useServerFn(runExtraction);
  const readPart = useServerFn(readInvoicePart);
  const finishReading = useServerFn(finishInvoiceReading);
  const [bill, setBill] = useState<File | null>(null);
  const [promise, setPromise] = useState<File | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [billType, setBillType] = useState<"refund" | "lab_invoice">("refund");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function upload(f: File, kind: string) {
    const ext = f.name.split(".").pop() ?? "bin";
    const path = `${user.id}/${crypto.randomUUID()}-${kind}.${ext}`;
    const { error } = await supabase.storage.from("documents").upload(path, f, { contentType: f.type });
    if (error) throw error;
    return { path, name: f.name, mime: f.type };
  }

  async function start() {
    if (!bill || !promise) return;
    setErrorMessage(null);
    let step = "Checking files";
    try {
      validateDocumentSize(bill.size);
      validateDocumentSize(promise.size);
      step = "Uploading files";
      setBusy("Uploading privately…");
      const [b, p] = await Promise.all([upload(bill, "bill"), upload(promise, "promise")]);
      if (billType === "lab_invoice") {
        step = "Preparing invoice pages";
        setBusy("Preparing invoice pages…");
        const { splitInvoicePdf } = await import("@/lib/pdf-pages");
        const files = await splitInvoicePdf(bill);
        step = "Reading price list";
        setBusy("Reading price list…");
        const priceList = await readPart({ data: { file: p, part: "price_list" } });
        if (!priceList.ok) throw new Error(priceList.error);
        const pages: string[] = [];
        const uploadedPages: string[] = [];
        let previousOrder: string | null = null;
        try {
          for (const [index, file] of files.entries()) {
            step = `Reading page ${index + 1} of ${files.length}`;
            setBusy(`${step}…`);
            const page = files.length === 1 ? b : await upload(file, `page-${index + 1}`);
            if (page.path !== b.path) uploadedPages.push(page.path);
            const result = await readPart({ data: { file: page, part: "invoice", previousOrder } });
            if (!result.ok) throw new Error(result.error);
            pages.push(result.cachePath);
            previousOrder = result.lastOrder ?? previousOrder;
          }
          step = "Combining and saving invoice";
          setBusy("Combining and saving invoice…");
          const result = await finishReading({ data: { bill: b, promise: p, pages, priceList: priceList.cachePath } });
          if (!result.ok) throw new Error(result.error);
          await navigate({ to: "/check/$billId", params: { billId: result.billId } });
          return;
        } finally {
          if (uploadedPages.length || pages.length) await supabase.storage.from("documents").remove([...uploadedPages, ...pages]);
        }
      }
      step = "Reading bill and refund promise";
      setBusy("Reading every line…");
      const { billId } = await extract({ data: { bill: b, promise: p, billType } });
      navigate({ to: "/check/$billId", params: { billId } });
    } catch (e) {
      const message = extractionErrorMessage(e);
      setErrorMessage(billType === "lab_invoice" ? readingStepError(step, message) : message);
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
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={billType === value}
              disabled={!!busy}
              onClick={() => setBillType(value)}
              className={`rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${billType === value ? "border-accent bg-accent/10 text-foreground" : "border-input bg-card text-muted-foreground hover:border-accent"}`}
            >
              {label}
            </button>
          ))}
        </div>
      </fieldset>
      <div className="mt-8 grid gap-4 md:grid-cols-2">
        <Drop label="Bill" hint="Card statement or vendor invoice" file={bill} onFile={setBill} />
        <Drop label="Promise" hint="Refund confirmation, contract or agreed price list" file={promise} onFile={setPromise} />
      </div>
      <Button variant="signal" size="lg" className="mt-8 w-full md:w-auto" disabled={!bill || !promise || !!busy} onClick={start}>
        {busy ? (<><Loader2 className="h-4 w-4 animate-spin" /> {busy}</>) : "Read both files"}
      </Button>
      {busy && <p role="status" aria-live="polite" className="mt-3 text-sm text-muted-foreground">{busy}</p>}
      {errorMessage && <p role="alert" className="mt-4 text-sm text-destructive">{errorMessage}</p>}
    </main>
  );
}
