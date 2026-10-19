import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { RefreshCw, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { replaceDandyPriceList } from "@/lib/invoice-reading.functions";

export function RereadPriceList({ billId, sourcePath }: { billId: string; sourcePath: string | null }) {
  const replace = useServerFn(replaceDandyPriceList);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function reread() {
    if (!sourcePath) return;
    setBusy(true); setError(null);
    let temporary: string | null = null;
    try {
      const downloaded = await supabase.storage.from("documents").download(sourcePath);
      if (downloaded.error || !downloaded.data) throw new Error("Couldn't open the original price list.");
      const { prepareDocument } = await import("@/lib/document-pages");
      const batches = await prepareDocument(new File([downloaded.data], "price-list.pdf", { type: downloaded.data.type || "application/pdf" }));
      if (batches.some(b => b.file.type !== "text/plain")) throw new Error("This price list needs a PDF with a readable text layer.");
      const text = (await Promise.all(batches.map(b => b.file.text()))).join("\n");
      temporary = `${sourcePath.split("/")[0]}/${crypto.randomUUID()}-reread.txt`;
      const uploaded = await supabase.storage.from("documents").upload(temporary, new Blob([text], { type: "text/plain" }), { contentType: "text/plain" });
      if (uploaded.error) throw new Error("Couldn't prepare the price list for reading.");
      await replace({ data: { billId, file: { path: temporary, name: "price-list.txt", mime: "text/plain" } } });
      window.location.reload();
    } catch (e) { setError(e instanceof Error ? e.message : "Couldn't re-read the price list."); }
    finally { if (temporary) await supabase.storage.from("documents").remove([temporary]); setBusy(false); }
  }
  return <div className="mt-3"><Button variant="outline" size="sm" disabled={busy || !sourcePath} onClick={reread}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}{busy ? "Re-reading price list…" : "Re-read price list"}</Button>{error && <p role="alert" className="mt-2 text-sm text-destructive">{error}</p>}</div>;
}