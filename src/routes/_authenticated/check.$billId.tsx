import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { maskSensitive } from "@/lib/mask";
import { toDate } from "@/lib/extraction";

export const Route = createFileRoute("/_authenticated/check/$billId")({
  head: () => ({
    meta: [
      { title: "Check these lines — BillShield" },
      { name: "description", content: "Review and correct the extracted lines before comparing." },
      { property: "og:title", content: "Check these lines — BillShield" },
      { property: "og:description", content: "Review and correct the extracted lines." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CheckPage,
});

type Line = { id: string; date: string | null; description: string | null; amount: number | null; type: string | null; reference_no: string | null; bank_ref: string | null };
type Prom = { id: string; promised_on: string | null; item: string | null; original_charge: number | null; promised_amount: number | null; reference_no: string | null; transaction_id: string | null; bank_ref: string | null; status_text: string | null; source: string | null };

function Cell({ value, onChange, type = "text", disabled }: { value: string; onChange: (v: string) => void; type?: string; disabled: boolean }) {
  return <Input className="h-8 min-w-24 font-mono text-xs" type={type === "date" ? "text" : type} step={type === "number" ? "any" : undefined} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} />;
}

function CheckPage() {
  const { billId } = Route.useParams();
  const [issuer, setIssuer] = useState<string | null>(null);
  const [billTotal, setBillTotal] = useState<number | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);
  const [proms, setProms] = useState<Prom[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const [b, l, p] = await Promise.all([
        supabase.from("bills").select("issuer, confirmed_at, bill_total").eq("id", billId).single(),
        supabase.from("line_items").select("id,date,description,amount,type,reference_no,bank_ref").eq("bill_id", billId).order("date"),
        supabase.from("promises").select("id,promised_on,item,original_charge,promised_amount,reference_no,transaction_id,bank_ref,status_text,source").eq("bill_id", billId),
      ]);
      setIssuer(b.data?.issuer ?? null);
      setBillTotal(b.data?.bill_total ?? null);
      setConfirmed(!!b.data?.confirmed_at);
      setLines((l.data ?? []) as Line[]);
      setProms((p.data ?? []) as Prom[]);
      setLoading(false);
    })();
  }, [billId]);

  const setL = (i: number, k: keyof Line, v: string) =>
    setLines((ls) => ls.map((x, j) => (j === i ? { ...x, [k]: k === "amount" ? (v === "" ? null : Number(v)) : v || null } : x)));
  const setP = (i: number, k: keyof Prom, v: string) =>
    setProms((ps) => ps.map((x, j) => (j === i ? { ...x, [k]: k === "promised_amount" || k === "original_charge" ? (v === "" ? null : Number(v)) : k === "bank_ref" ? v : v || null } : x)));

  async function looksRight() {
    setSaving(true);
    try {
      for (const date of [...lines.map((l) => l.date), ...proms.map((p) => p.promised_on)]) {
        if (date && !toDate(date)) throw new Error("Enter dates as YYYY-MM-DD or leave them empty.");
      }
      for (const l of lines) {
        const { id, ...rest } = l;
        const { error } = await supabase.from("line_items").update({ ...rest, description: maskSensitive(rest.description), reference_no: maskSensitive(rest.reference_no, "identifier"), bank_ref: maskSensitive(rest.bank_ref, "identifier") }).eq("id", id);
        if (error) throw error;
      }
      for (const p of proms) {
        const { id, ...rest } = p;
        const { error } = await supabase.from("promises").update({ ...rest, item: maskSensitive(rest.item), source: maskSensitive(rest.source), status_text: maskSensitive(rest.status_text), bank_ref: rest.bank_ref ?? "" }).eq("id", id);
        if (error) throw error;
      }
      const { error } = await supabase.from("bills").update({ issuer: maskSensitive(issuer), bill_total: billTotal, confirmed_at: new Date().toISOString() }).eq("id", billId);
      if (error) throw error;
      setConfirmed(true);
      toast.success("Lines confirmed");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  const th = "px-2 py-2 text-left font-mono text-[10px] uppercase tracking-wider text-muted-foreground";
  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <h1 className="text-3xl font-bold">Check these lines</h1>
      <p className="mt-2 text-muted-foreground">Fix anything that was read wrong. Nothing is compared until you confirm.</p>

      <div className="mt-6 max-w-sm space-y-1">
        <span className={th}>Bill issuer</span>
        <Cell value={issuer ?? ""} onChange={(v) => setIssuer(v || null)} disabled={confirmed} />
      </div>

      <h2 className="mt-8 font-semibold">Bill transactions</h2>
      <div className="mt-2 overflow-x-auto rounded-lg border border-border bg-card shadow-card">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-border">
            {["Date", "Description", "Amount", "Type", "Reference", "Bank ref"].map((h) => <th key={h} className={th}>{h}</th>)}
          </tr></thead>
          <tbody>
            {lines.length === 0 && <tr><td colSpan={6} className="p-4 text-muted-foreground">No lines found.</td></tr>}
            {lines.map((l, i) => (
              <tr key={l.id} className="border-b border-border last:border-0">
                <td className="p-1"><Cell type="date" value={l.date ?? ""} onChange={(v) => setL(i, "date", v)} disabled={confirmed} /></td>
                <td className="p-1"><Cell value={l.description ?? ""} onChange={(v) => setL(i, "description", v)} disabled={confirmed} /></td>
                <td className="p-1"><Cell type="number" value={l.amount?.toString() ?? ""} onChange={(v) => setL(i, "amount", v)} disabled={confirmed} /></td>
                <td className="p-1">
                  <select className="h-8 rounded-md border border-input bg-background px-2 text-xs" value={l.type ?? ""} disabled={confirmed} onChange={(e) => setL(i, "type", e.target.value)}>
                    <option value="">—</option><option value="charge">charge</option><option value="credit">credit</option>
                  </select>
                </td>
                <td className="p-1"><Cell value={l.reference_no ?? ""} onChange={(v) => setL(i, "reference_no", v)} disabled={confirmed} /></td>
                <td className="p-1"><Cell value={l.bank_ref ?? ""} onChange={(v) => setL(i, "bank_ref", v)} disabled={confirmed} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4 max-w-sm space-y-2">
        <Label htmlFor="bill-total">Statement total</Label>
        <Input id="bill-total" type="number" step="any" value={billTotal ?? ""} disabled={confirmed} onChange={(e) => setBillTotal(e.target.value === "" ? null : Number(e.target.value))} />
      </div>

      <h2 className="mt-8 font-semibold">Promise</h2>
      <div className="mt-3 space-y-4">
        {proms.map((p, i) => (
          <section key={p.id} aria-label={`Promise ${i + 1}`} className="rounded-lg border border-border bg-card p-5 shadow-card">
            {p.source && <p className="mb-4 text-sm text-muted-foreground">{p.source}</p>}
            <div className="grid gap-4 sm:grid-cols-2">
              {([
                ["item", "Item", "text"],
                ["original_charge", "Original charge", "number"],
                ["promised_amount", "Promised amount / Total refund amount", "number"],
                ["reference_no", "Cancellation / Refund ID / Reference", "text"],
                ["transaction_id", "Transaction ID", "text"],
                ["bank_ref", "Bank Reference Id", "text"],
                ["promised_on", "Refund / transaction date", "date"],
                ["status_text", "Remark / status", "text"],
              ] as const).map(([key, label, type]) => (
                <div key={key} className="min-w-0 space-y-2">
                  <Label htmlFor={`${p.id}-${key}`}>{label}</Label>
                  <Input id={`${p.id}-${key}`} type={type === "date" ? "text" : type} step={type === "number" ? "any" : undefined} className="font-mono text-sm" value={p[key] ?? ""} disabled={confirmed} onChange={(e) => setP(i, key, e.target.value)} />
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>

      {confirmed ? (
        <p className="mt-8 flex items-center gap-2 font-medium text-success"><CheckCircle2 className="h-5 w-5" /> Lines confirmed — ready to compare.</p>
      ) : (
        <Button variant="signal" size="lg" className="mt-8" disabled={saving} onClick={looksRight}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Looks right
        </Button>
      )}
    </main>
  );
}
