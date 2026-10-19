import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { confirmCheck, generateCheckDrafts } from "@/lib/comparison.functions";
import { matchInvoiceItems, groupInvoiceMatches, applyGroupMatch, reconcileInvoice, isComparablePromise, closestPriceListNames, type ReviewedLine, type ReviewedPromise } from "@/lib/comparison";
import { priceListSectionCounts } from "@/lib/dandy";
import { typedDetailsSchema, type TypedDetails } from "@/lib/typed-promise";
import { TypedPromiseFields } from "@/components/typed-promise-fields";

import { formatCurrency } from "@/lib/message-format";

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

type Line = { id: string; date: string | null; description: string | null; amount: number | null; type: string | null; reference_no: string | null; bank_ref: string | null; order_no: string | null; tax_amount: number | null; total_amount: number | null };
type Prom = { id: string; promised_on: string | null; item: string | null; original_charge: number | null; promised_amount: number | null; reference_no: string | null; transaction_id: string | null; bank_ref: string | null; status_text: string | null; source: string | null; pnr: string | null; promise_kind: string | null; notes: string | null; typed_details?: TypedDetails | null };

function Cell({ value, onChange, type = "text", disabled }: { value: string; onChange: (v: string) => void; type?: string; disabled: boolean }) {
  return <Input className="h-8 min-w-24 font-mono text-xs" type={type === "date" ? "text" : type} step={type === "number" ? "any" : undefined} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} />;
}

function CheckPage() {
  const { billId } = Route.useParams();
  const navigate = useNavigate();
  const confirm = useServerFn(confirmCheck);
  const draft = useServerFn(generateCheckDrafts);
  const [issuer, setIssuer] = useState<string | null>(null);
  const [ordersSubtotal, setOrdersSubtotal] = useState<number | null>(null);
  const [billType, setBillType] = useState<string | null>(null);
  const [billTotal, setBillTotal] = useState<number | null>(null);
  const [currency, setCurrency] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);
  const [proms, setProms] = useState<Prom[]>([]);
  const [matchOverrides, setMatchOverrides] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const [b, l, p] = await Promise.all([
        supabase.from("bills").select("issuer, confirmed_at, bill_total,currency,orders_subtotal,bill_type").eq("id", billId).single(),
        supabase.from("line_items").select("id,date,description,amount,type,reference_no,bank_ref,order_no,tax_amount,total_amount").eq("bill_id", billId).order("date"),
        supabase.from("promises").select("id,promised_on,item,original_charge,promised_amount,reference_no,transaction_id,bank_ref,status_text,source,pnr,promise_kind,notes,typed_details").eq("bill_id", billId),
      ]);
      setIssuer(b.data?.issuer ?? null);
      setOrdersSubtotal(b.data?.orders_subtotal ?? null);
      setBillType(b.data?.bill_type ?? null);
      setBillTotal(b.data?.bill_total ?? null);
      setCurrency(b.data?.currency ?? null);
      setConfirmed(!!b.data?.confirmed_at);
      setLines((l.data ?? []) as Line[]);
      setProms((p.data ?? []).map(row => ({ ...row, typed_details: row.typed_details ? typedDetailsSchema.parse(row.typed_details) : null })));
      setLoading(false);
    })();
  }, [billId]);

  const setL = (i: number, k: keyof Line, v: string) =>
    setLines((ls) => ls.map((x, j) => (j === i ? { ...x, [k]: ["amount", "tax_amount", "total_amount"].includes(k) ? (v === "" ? null : Number(v)) : v || null } : x)));
  const setP = (i: number, k: keyof Prom, v: string) =>
    setProms((ps) => ps.map((x, j) => (j === i ? { ...x, [k]: k === "promised_amount" || k === "original_charge" ? (v === "" ? null : Number(v)) : k === "bank_ref" ? v : v || null } : x)));

  async function looksRight() {
    if (unconfirmedLow.length) { toast.error("Confirm each low-confidence item match before continuing."); return; }
    setSaving(true);
    try {
      const validLines = lines.map((line) => {
        if (line.type !== "charge" && line.type !== "credit") throw new Error("Choose charge or credit for each transaction.");
        return { ...line, type: line.type };
      });
      await confirm({ data: { billId, issuer, billTotal, currency, lines: validLines, promises: proms, confirmedMatches: matchOverrides } });
      setConfirmed(true);
      try { await draft({ data: { billId } }); }
      catch (error) { toast.error(error instanceof Error ? error.message : "The maths is saved, but the message couldn't be written."); }
      await navigate({ to: "/result/$billId", params: { billId } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  const isTyped = proms.some(p => p.typed_details);
  const isPriceList = !isTyped && proms.length > 0 && proms.every((p) => p.promise_kind === "price_list" || p.promise_kind === "contract");
  const suggestedMatches = isPriceList && !confirmed
    ? matchInvoiceItems(lines as ReviewedLine[], proms as unknown as ReviewedPromise[])
    : [];
  const matchGroups = groupInvoiceMatches(lines, suggestedMatches);
  const unconfirmedLow = matchGroups.filter((g) => g.match.confidence < 0.85 && g.line_ids.some((id) => !matchOverrides[id]));
  const reconciliation = billType === "lab_invoice" ? reconcileInvoice(lines as ReviewedLine[], ordersSubtotal) : null;

  const th = "px-2 py-2 text-left font-mono text-[10px] uppercase tracking-wider text-muted-foreground";
  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <h1 className="text-3xl font-bold">Check these lines</h1>
      <p className="mt-2 text-muted-foreground">Fix anything that was read wrong. Nothing is compared until you confirm.</p>

      <div className="mt-6 max-w-sm space-y-1">
        <span className={th}>Bill issuer</span>
        <Cell value={issuer ?? ""} onChange={(v) => setIssuer(v || null)} disabled={confirmed} />
      </div>

      {reconciliation && <p className="mt-6 border-y border-border py-4 font-mono text-sm">Items total {formatCurrency(reconciliation.items_total, currency)} vs invoice Orders {formatCurrency(reconciliation.orders_subtotal, currency)} {reconciliation.matches === true ? "✓" : reconciliation.matches === false ? "— mismatch" : "— needs review"}</p>}
      <h2 className="mt-8 font-semibold">Bill transactions</h2>
      <div className="mt-2 overflow-x-auto rounded-lg border border-border bg-card shadow-card">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-border">
            {["Date", "Description", "Amount", "Type", "Reference", "Bank ref", ...(isTyped ? ["Billed tax", "Billed total"] : [])].map((h) => <th key={h} className={th}>{h}</th>)}
          </tr></thead>
          <tbody>
            {lines.length === 0 && <tr><td colSpan={6} className="p-4 text-muted-foreground">No lines found.</td></tr>}
            {lines.map((l, i) => (
              <tr key={l.id} className="border-b border-border last:border-0">
                <td className="p-1"><Cell type="date" value={l.date ?? ""} onChange={(v) => setL(i, "date", v)} disabled={confirmed} /></td>
                <td className="p-1"><Cell value={l.description ?? ""} onChange={(v) => setL(i, "description", v)} disabled={confirmed} />{isPriceList && l.amount === 0 && <span className="text-xs text-muted-foreground">Included – $0</span>}</td>
                <td className="p-1"><Cell type="number" value={l.amount?.toString() ?? ""} onChange={(v) => setL(i, "amount", v)} disabled={confirmed} /></td>
                <td className="p-1">
                  <select className="h-8 rounded-md border border-input bg-background px-2 text-xs" value={l.type ?? ""} disabled={confirmed} onChange={(e) => setL(i, "type", e.target.value)}>
                    <option value="">—</option><option value="charge">charge</option><option value="credit">credit</option>
                  </select>
                </td>
                <td className="p-1"><Cell value={(billType === "lab_invoice" ? l.order_no ?? l.reference_no : l.reference_no) ?? ""} onChange={(v) => setL(i, billType === "lab_invoice" ? "order_no" : "reference_no", v)} disabled={confirmed} /></td>
                <td className="p-1"><Cell value={l.bank_ref ?? ""} onChange={(v) => setL(i, "bank_ref", v)} disabled={confirmed} /></td>
                {isTyped && <><td className="p-1"><Cell type="number" value={l.tax_amount?.toString() ?? ""} onChange={v => setL(i, "tax_amount", v)} disabled={confirmed} /></td><td className="p-1"><Cell type="number" value={l.total_amount?.toString() ?? ""} onChange={v => setL(i, "total_amount", v)} disabled={confirmed} /></td></>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4 max-w-sm space-y-2">
        <Label htmlFor="currency">Currency</Label>
        <Input id="currency" value={currency ?? ""} maxLength={3} disabled={confirmed} onChange={(e) => setCurrency(e.target.value.toUpperCase() || null)} />
        <Label htmlFor="bill-total">Statement total</Label>
        <Input id="bill-total" type="number" step="any" value={billTotal ?? ""} disabled={confirmed} onChange={(e) => setBillTotal(e.target.value === "" ? null : Number(e.target.value))} />
      </div>

      <h2 className="mt-8 font-semibold">{isTyped ? "Promise you entered (no document)" : "Promise"}</h2>
      {proms.map((p, i) => p.typed_details ? <TypedPromiseFields key={p.id} details={p.typed_details} lines={lines} disabled={confirmed} onChange={details => setProms(rows => rows.map((row, j) => j === i ? { ...row, typed_details: details } : row))} /> : null)}
      {isPriceList && <section className="mt-3 border-y border-border py-4" aria-label="Saved price-list sections"><h3 className="text-sm font-semibold">Price list · {proms.length} rows saved</h3><dl className="mt-3 grid gap-2 sm:grid-cols-2">{priceListSectionCounts(proms).map(({ section, count }) => <div key={section} className="flex min-w-0 justify-between gap-3 text-xs"><dt className="break-words text-muted-foreground">{section}</dt><dd className="shrink-0 font-mono">{count} rows</dd></div>)}</dl></section>}
      {isPriceList ? (
        <div className="mt-2 overflow-x-auto rounded-lg border border-border bg-card shadow-card">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-border">
              {["Item", "Agreed price", "Notes"].map((h) => <th key={h} className={th}>{h}</th>)}
            </tr></thead>
            <tbody>
              {proms.map((p, i) => {
                const comparable = isComparablePromise(p);
                return (
                  <tr key={p.id} className={`border-b border-border last:border-0 ${comparable ? "" : "opacity-60"}`}>
                    <td className="p-1"><Cell value={p.item ?? ""} onChange={(v) => setP(i, "item", v)} disabled={confirmed} /></td>
                    <td className="p-1"><Cell type="number" value={p.promised_amount?.toString() ?? ""} onChange={(v) => setP(i, "promised_amount", v)} disabled={confirmed} /></td>
                    <td className="p-2 text-xs text-muted-foreground">{comparable ? (p.notes ?? "—") : "Not comparable — skipped"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
      <div className="mt-3 space-y-4">
        {proms.map((p, i) => (
          <section key={p.id} aria-label={`Promise ${i + 1}`} className="rounded-lg border border-border bg-card p-5 shadow-card">
            {p.source && <p className="mb-4 text-sm text-muted-foreground">{p.source}</p>}
            <div className="grid gap-4 sm:grid-cols-2">
              {([
                ["source", "Promise issuer", "text"],
                ["pnr", "PNR", "text"],
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
      )}

      {isPriceList && !confirmed && matchGroups.length > 0 && (
        <>
          <h2 className="mt-8 font-semibold">Suggested item matches</h2>
          <p className="mt-1 text-sm text-muted-foreground">Low-confidence matches must be confirmed before comparing.</p>
          <div className="mt-2 space-y-2">
            {matchGroups.map((group) => {
              const m = group.match;
              const promise = proms.find((p) => p.id === (matchOverrides[m.line_id] ?? m.promise_id));
              const low = m.confidence < 0.85;
              return (
                <div key={m.line_id} className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card p-3 text-sm shadow-card">
                  <span className="min-w-0 flex-1 break-words">{group.name} <span className="text-xs text-muted-foreground">({group.line_ids.length} {group.line_ids.length === 1 ? "line" : "lines"})</span></span>
                  <span className="text-muted-foreground">→</span>
                  <select
                    className="h-8 max-w-64 rounded-md border border-input bg-background px-2 text-xs"
                    value={matchOverrides[m.line_id] ?? m.promise_id ?? ""}
                    onChange={(e) => setMatchOverrides((prev) => applyGroupMatch(prev, group.line_ids, e.target.value))}
                  >
                    {proms.filter(isComparablePromise).map((p) => <option key={p.id} value={p.id}>{p.item}</option>)}
                  </select>
                  <Button size="sm" variant="outline" onClick={() => setMatchOverrides((prev) => applyGroupMatch(prev, group.line_ids, prev[m.line_id] ?? m.promise_id ?? ""))}>{matchOverrides[m.line_id] ? "Confirmed" : "Confirm"}</Button>
                  <span className={`font-mono text-xs ${low ? "text-destructive" : "text-success"}`}>{Math.round(m.confidence * 100)}%{low && !matchOverrides[m.line_id] ? " — confirm" : ""}</span>
                </div>
              );
            })}
          </div>
        </>
      )}

      {isPriceList && !confirmed && suggestedMatches.some((m) => m.disposition === "no_contract") && <section className="mt-8 border-t border-border pt-5"><h2 className="font-semibold">No contract price – review</h2>{suggestedMatches.filter((m) => m.disposition === "no_contract").map((m) => { const row = lines.find((l) => l.id === m.line_id); return <div key={m.line_id} className="mt-4"><p className="break-words text-sm font-medium">{row?.description}</p><p className="mt-1 text-xs text-muted-foreground">Closest price-list names</p><ul className="mt-2 list-inside list-disc space-y-1 text-xs text-muted-foreground">{closestPriceListNames(row?.description ?? null, proms).map((name) => <li key={name} className="break-words">{name}</li>)}</ul></div>; })}</section>}
      {confirmed ? (
        <div className="mt-8 space-y-4"><p className="flex items-center gap-2 font-medium text-success"><CheckCircle2 className="h-5 w-5" /> Lines confirmed</p><Button variant="signal" disabled={saving} onClick={looksRight}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}View result</Button></div>
      ) : (
        <Button variant="signal" size="lg" className="mt-8" disabled={saving} onClick={looksRight}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null} {saving ? "Checking and writing…" : "Looks right"}
        </Button>
      )}
    </main>
  );
}
