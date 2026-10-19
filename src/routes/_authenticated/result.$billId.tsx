import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { queryOptions, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useState } from "react";
import { AlertTriangle, CheckCircle2, Copy, Loader2, MessageCircleQuestion, Send, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { getCheckResult, generateCheckDrafts, saveMessageDecision, askCheckQuestion } from "@/lib/comparison.functions";
import { reconcileInvoice, type Finding } from "@/lib/comparison";
import { DRAFT_VERSION, formatCurrency } from "@/lib/message-format";
import type { Tables } from "@/integrations/supabase/types";
import { invoiceSummary, REVIEW_DRAFT_VERSION } from "@/lib/invoice-results";

const resultQuery = (billId: string) => queryOptions({ queryKey: ["check-result", billId], queryFn: () => getCheckResult({ data: { billId } }) });

export const Route = createFileRoute("/_authenticated/result/$billId")({
  head: () => ({ meta: [
    { title: "Your bill check result — BillShield" },
    { name: "description", content: "See the exact bill maths, flagged transactions and your ready-to-send dispute message." },
    { property: "og:title", content: "Your bill check result — BillShield" },
    { property: "og:description", content: "Your confirmed bill comparison, contact choice and saved message." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" },
  ] }),
  loader: ({ context, params }) => context.queryClient.ensureQueryData(resultQuery(params.billId)),
  component: ResultPage,
  errorComponent: ({ error }) => <main className="mx-auto max-w-3xl px-4 py-12"><h1 className="text-2xl font-bold">Couldn't load this check</h1><p className="mt-4 text-muted-foreground">{error instanceof Error ? error.message : "This check could not be loaded."}</p><Button asChild variant="outline" className="mt-6"><Link to="/new">New check</Link></Button></main>,
});

function Maths({ finding }: { finding: Finding }) {
  const amount = (v: string | number | null) => formatCurrency(v, finding.currency);
  const fields: [string, string | number | null][] = finding.kind === "refund"
    ? [["Charged", finding.charged], ["Refund promised", finding.promised], ["Kept by merchant", finding.kept_by_merchant], ["Credit expected", finding.credit_expected], ["Credit found", finding.credit_found], ["Days waiting", finding.days_waiting]]
    : [["Invoiced", finding.charged], ["Agreed price", finding.promised], ["Overcharge", finding.overcharge]];
  return <div className="mt-6 border-y border-border py-5"><h3 className="font-semibold">The maths</h3><dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">{fields.map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 break-words font-mono text-lg font-medium">{label === "Days waiting" ? value ?? "—" : amount(value)}</dd></div>)}</dl>{finding.kind === "refund" && finding.charged !== null && finding.promised !== null && <p className="mt-4 break-words font-mono text-xs text-muted-foreground">{amount(finding.charged)} − {amount(finding.promised)} = {amount(finding.kept_by_merchant)}</p>}{finding.promised_on && <p className="mt-2 text-xs text-muted-foreground">Promised on {finding.promised_on}</p>}</div>;
}

function MessageEditor({ message, billId, contactName }: { message: Tables<"messages">; billId: string; contactName: string }) {
  const [text, setText] = useState(message.final_text ?? message.draft_text ?? "");
  const [busy, setBusy] = useState(false);
  const save = useServerFn(saveMessageDecision);
  const queryClient = useQueryClient();
  async function decide(decision: "sent" | "not_sending") {
    setBusy(true);
    try {
      await save({ data: { messageId: message.id, finalText: text, decision } });
      await queryClient.invalidateQueries({ queryKey: ["check-result", billId] });
      toast.success(decision === "sent" ? "Marked as sent" : "Marked as not sending");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Couldn't save this decision."); }
    finally { setBusy(false); }
  }
  async function copy() {
    try { await navigator.clipboard.writeText(text); toast.success("Message copied"); }
    catch { toast.error("Couldn't copy. Select the message and copy it."); }
  }
  return <div className="mt-6"><div className="flex items-center justify-between gap-3"><Label htmlFor={`draft-${message.id}`} className="min-w-0 break-words font-semibold">Message to {contactName}</Label><Button size="sm" variant="outline" onClick={copy} disabled={!text}><Copy className="h-4 w-4" />Copy</Button></div><Textarea id={`draft-${message.id}`} value={text} onChange={(e) => setText(e.target.value)} disabled={message.sent || busy} className="mt-3 min-h-80 text-sm leading-relaxed" />
    {message.sent ? <div className="mt-4 space-y-1"><p className="flex items-center gap-2 font-medium text-success"><CheckCircle2 className="h-4 w-4" />I sent it</p><p className="font-mono text-sm">Words changed: {message.words_changed ?? 0}</p>{message.sent_at && <p className="text-xs text-muted-foreground">{new Date(message.sent_at).toLocaleString()}</p>}</div>
      : message.declined_at ? <p className="mt-4 flex items-center gap-2 text-muted-foreground"><X className="h-4 w-4" />Not sending</p>
      : <div className="mt-4 flex flex-wrap gap-3"><Button variant="signal" disabled={busy || !text.trim()} onClick={() => decide("sent")}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}I sent it</Button><Button variant="outline" disabled={busy} onClick={() => decide("not_sending")}><X className="h-4 w-4" />Not sending</Button></div>}
  </div>;
}

function AskQuestion({ billId }: { billId: string }) {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ask = useServerFn(askCheckQuestion);
  async function submit() {
    setBusy(true);
    try {
      const { answer } = await ask({ data: { billId, question } });
      setAnswer(answer);
    } catch (error) { toast.error(error instanceof Error ? error.message : "Couldn't answer this question."); }
    finally { setBusy(false); }
  }
  return (
    <section className="mt-8 border-t border-border pt-6">
      <h2 className="flex items-center gap-2 font-semibold"><MessageCircleQuestion className="h-5 w-5 text-accent" />Ask a question</h2>
      <p className="mt-1 text-xs text-muted-foreground">Answers use only this check's saved maths, references and contact routing.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {["Who do I contact and what do I do?", "What if they don't reply in 7 days?"].map((suggestion) => (
          <Button key={suggestion} size="sm" variant="outline" disabled={busy} onClick={() => setQuestion(suggestion)}>{suggestion}</Button>
        ))}
      </div>
      <Textarea value={question} onChange={(e) => setQuestion(e.target.value)} disabled={busy} placeholder="Ask about this check…" className="mt-3 min-h-20 text-sm" />
      <Button variant="signal" className="mt-3" disabled={busy || !question.trim()} onClick={submit}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}Ask
      </Button>
      {answer && <p className="mt-4 whitespace-pre-wrap border-l-2 border-accent pl-4 text-sm leading-relaxed">{answer}</p>}
    </section>
  );
}

function ResultPage() {
  const { billId } = Route.useParams();
  const { data } = useSuspenseQuery(resultQuery(billId));
  const comparison = data.bill.comparison_result;
  const queryClient = useQueryClient();
  const generate = useServerFn(generateCheckDrafts);
  const [busy, setBusy] = useState(false);
  async function draft() {
    setBusy(true);
    try { await generate({ data: { billId } }); await queryClient.invalidateQueries({ queryKey: ["check-result", billId] }); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Couldn't write the message."); }
    finally { setBusy(false); }
  }
  if (!comparison) return <main className="mx-auto max-w-3xl px-4 py-12"><h1 className="text-3xl font-bold">Confirm your lines first</h1><Button asChild variant="signal" className="mt-6"><Link to="/check/$billId" params={{ billId }}>Check these lines</Link></Button></main>;
  const reconciliation = data.bill.bill_type === "lab_invoice" ? comparison.reconciliation ?? reconcileInvoice(data.lines, data.bill.orders_subtotal) : null;
  const missingDraft = comparison.findings.some((f) => f.flagged && !data.messages.some((m) => m.line_id === f.line_id));
  const outdatedDraft = data.messages.some((m) => !m.sent && !m.declined_at && m.final_text === null && m.draft_version !== DRAFT_VERSION);
  if (data.bill.bill_type === "lab_invoice") return <LabResults data={data} billId={billId} busy={busy} draft={draft} />;
  return <main className="mx-auto max-w-3xl px-4 py-10"><div className="flex flex-wrap items-center justify-between gap-4"><p className="font-mono text-xs uppercase text-muted-foreground">BillShield / Check result</p><Button asChild variant="outline" size="sm"><Link to="/new">New check</Link></Button></div>
    <div className="mt-8 flex items-start gap-3">{comparison.status === "clear" ? <CheckCircle2 className="mt-1 h-7 w-7 shrink-0 text-success" /> : <AlertTriangle className="mt-1 h-7 w-7 shrink-0 text-destructive" />}<div className="min-w-0"><h1 className="text-3xl font-bold">{comparison.status === "clear" ? (data.bill.bill_type === "lab_invoice" ? "No overcharges found on fixed-price items" : "Nothing wrong with this bill") : comparison.status === "flagged" ? "This line doesn't add up" : "This check needs more information"}</h1>{data.bill.issuer && <p className="mt-2 break-words text-muted-foreground">{data.bill.issuer}</p>}<p className="mt-2 text-xs text-muted-foreground">Checked on {comparison.checked_on}</p></div></div>
    {reconciliation && <p className="mt-6 border-y border-border py-4 font-mono text-sm">Items total {formatCurrency(reconciliation.items_total, data.bill.currency)} vs invoice Orders {formatCurrency(reconciliation.orders_subtotal, data.bill.currency)} {reconciliation.matches === true ? "✓" : reconciliation.matches === false ? "— mismatch" : "— needs review"}</p>}
    {comparison.issues.length > 0 && <div className="mt-6 border-l-2 border-accent pl-4"><h2 className="font-semibold">Not fully checked</h2>{comparison.issues.map((issue) => <p key={issue} className="mt-2 break-words text-sm text-muted-foreground">{issue}</p>)}</div>}
    {comparison.findings.filter((f) => f.disposition !== "no_contract").map((f, i) => {
      const line = data.lines.find((l) => l.id === f.line_id);
      const message = data.messages.find((m) => m.line_id === f.line_id);
      return <section key={`${f.promise_id}-${f.line_id ?? i}`} className="mt-8 border-t border-border pt-6">
        {line && <div className={`border-l-4 p-4 ${f.flagged ? "border-destructive bg-destructive/10" : "border-success bg-success/10"}`}><h2 className="break-words font-semibold">{line.description || "Transaction"}</h2><div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 font-mono text-sm"><span>{formatCurrency(line.amount, f.currency)}</span><span>{line.type}</span>{line.date && <span>{line.date}</span>}</div>{(line.order_no ?? line.reference_no) && <p className="mt-2 break-all font-mono text-xs">Reference: {line.order_no ?? line.reference_no}</p>}{f.flag_reason && <p className="mt-3 text-sm">{f.flag_reason}</p>}{f.note && <p className="mt-3 text-sm text-muted-foreground">{f.note}</p>}</div>}
        {(!f.disposition || f.disposition === "matched") && <Maths finding={f} />}
        {f.contact_reason && <div className="mt-5"><h3 className="font-semibold">Who to contact and why</h3><p className="mt-2 text-sm leading-relaxed">{f.contact_reason}</p></div>}
        {message && f.flagged && <MessageEditor key={`${message.id}-${message.draft_version}`} message={message} billId={billId} contactName={f.contact_name ?? (f.recipient === "BANK" ? "your bank" : "the billing company")} />}
      </section>;
    })}
    {comparison.findings.some((f) => f.disposition === "no_contract") && <section className="mt-8 border-t border-border pt-6"><h2 className="text-xl font-semibold">No contract price – review</h2><div className="mt-4 divide-y divide-border">{comparison.findings.filter((f) => f.disposition === "no_contract").map((f) => <div key={f.line_id} className="py-4"><h3 className="break-words font-medium">{f.invoice_item ?? f.item}</h3><p className="mt-1 font-mono text-sm">{formatCurrency(f.charged, data.bill.currency)}</p>{f.order_no && <p className="mt-1 break-all text-xs text-muted-foreground">Reference: {f.order_no}</p>}</div>)}</div></section>}
    {(missingDraft || outdatedDraft) && <Button variant="signal" className="mt-6" disabled={busy} onClick={draft}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}{outdatedDraft ? "Update message" : "Write message"}</Button>}
    <AskQuestion billId={billId} />
  </main>;
}

function LabResults({ data, billId, busy, draft }: { data: Awaited<ReturnType<typeof getCheckResult>>; billId: string; busy: boolean; draft: () => Promise<void> }) {
  const [showIncluded, setShowIncluded] = useState(false);
  const comparison = data.bill.comparison_result;
  if (!comparison) return null;
  const summary = invoiceSummary(comparison.findings);
  const amount = (value: string | null | undefined) => formatCurrency(value, data.bill.currency);
  const reconciliation = comparison.reconciliation;
  const review = summary.buckets.find((b) => b.key === "review");
  const reviewMessage = data.messages.find((m) => m.draft_version === REVIEW_DRAFT_VERSION);
  const needDraft = (!!review?.count && !reviewMessage) || comparison.findings.some((f) => f.flagged && !data.messages.some((m) => m.line_id === f.line_id));
  const taxWarnings = comparison.issues.filter((i) => !i.startsWith("No contract price"));
  const checks = reconciliation ? [
    { label: "items", value: reconciliation.items_total, matches: reconciliation.matches },
    { label: "tax", value: reconciliation.tax_total, matches: reconciliation.tax_matches },
    { label: "credits", value: reconciliation.credits_total == null ? null : `-${reconciliation.credits_total}`, matches: reconciliation.credits_matches },
    { label: "total", value: reconciliation.total, matches: reconciliation.total_matches },
  ] : [];
  return <main className="mx-auto max-w-3xl px-4 py-10">
    <div className="flex flex-wrap items-center justify-between gap-4"><p className="font-mono text-xs uppercase text-muted-foreground">BillShield / Lab invoice result</p><Button asChild variant="outline" size="sm"><Link to="/new">New check</Link></Button></div>
    <header className="mt-8"><div className="flex items-start gap-3">{summary.overcharge_count ? <AlertTriangle className="mt-1 h-7 w-7 shrink-0 text-destructive" /> : <CheckCircle2 className="mt-1 h-7 w-7 shrink-0 text-success" />}<h1 className="min-w-0 break-words text-3xl font-bold">{summary.overcharge_count ? `${summary.overcharge_count} overcharge${summary.overcharge_count === 1 ? "" : "s"} found – ${amount(summary.overcharge_total)}` : "No overcharges found"}</h1></div>{data.bill.issuer && <p className="mt-3 break-words text-muted-foreground">{data.bill.issuer}</p>}<p className="mt-2 text-xs text-muted-foreground">Checked on {comparison.checked_on}</p></header>
    <section className="mt-6 border-y border-border py-5" aria-label="Invoice summary">
      <dl className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">{summary.buckets.filter((b) => b.count || ["matches", "overcharged", "staged", "included", "review"].includes(b.key)).map((b) => <div key={b.key} className="min-w-0"><dt className="text-sm text-muted-foreground">{b.label}</dt><dd className="mt-1 font-mono text-sm">{b.count} item{b.count === 1 ? "" : "s"} · {amount(b.total)}{b.key === "overcharged" && b.count > 0 && <span className="block text-destructive">Overcharge {amount(summary.overcharge_total)}</span>}</dd></div>)}</dl>
      <div className="mt-5 flex flex-wrap gap-x-4 gap-y-2 border-t border-border pt-4 font-mono text-sm" aria-label="Reconciliation">{checks.map((check) => <span key={check.label} className={check.matches === false ? "text-destructive" : "text-foreground"}>{check.label} {check.label === "credits" && reconciliation?.credits_total != null ? `−${amount(reconciliation.credits_total)}` : amount(check.value)} {check.matches === true ? "✓" : check.matches === false ? "— mismatch" : "— unverified"}</span>)}</div>
      {taxWarnings.length > 0 && <div className="mt-4 border-l-2 border-destructive pl-3">{taxWarnings.map((issue) => <p key={issue} className="mt-2 break-words text-sm text-muted-foreground">{issue}</p>)}</div>}
      {!!review?.count && <div className="mt-5 border-t border-border pt-4"><h2 className="font-semibold">No contract price – review</h2><ul className="mt-3 space-y-3">{review.items.map((f) => <li key={f.line_id} className="min-w-0"><p className="break-words text-sm font-medium">{f.invoice_item ?? f.item}</p><p className="mt-1 break-words font-mono text-xs text-muted-foreground">Order {f.order_no ?? "not provided"} · {amount(f.charged)}</p></li>)}</ul></div>}
    </section>
    <div className="mt-6">{summary.buckets.filter((b) => b.count > 0 && (b.key !== "included" || showIncluded)).map((b) => <details key={b.key} className="border-b border-border py-4"><summary className="cursor-pointer break-words text-sm font-semibold">{b.label} <span className="font-mono font-normal text-muted-foreground">({b.count}) · {amount(b.total)}</span></summary><div className="mt-4 divide-y divide-border">{b.items.map((f) => <div key={f.line_id} className="min-w-0 py-4"><h3 className="break-words font-medium">{f.invoice_item ?? f.item}</h3><p className="mt-2 break-words font-mono text-sm">Order {f.order_no ?? "not provided"} · {amount(f.charged)}</p>{["matches", "overcharged", "below"].includes(b.key) && <p className="mt-3 break-words font-mono text-sm">{amount(f.charged)} − {amount(f.promised)} = {amount(f.overcharge)}{b.key === "overcharged" ? " overcharge" : b.key === "below" ? " below list" : " difference"}</p>}{b.key === "staged" && <p className="mt-3 text-sm text-muted-foreground">Staged – check when order completes</p>}{b.key === "not_comparable" && <p className="mt-3 text-sm text-muted-foreground">No fixed contract price to compare</p>}{f.flagged && data.messages.filter((m) => m.line_id === f.line_id).map((m) => <MessageEditor key={m.id} message={m} billId={billId} contactName={m.sent_to ?? data.bill.issuer ?? "the vendor"} />)}</div>)}</div></details>)}</div>
    {!!summary.buckets.find((b) => b.key === "included")?.count && <Button variant="ghost" size="sm" className="mt-4" onClick={() => setShowIncluded((value) => !value)}>{showIncluded ? "Hide" : "Show"} included items</Button>}
    {reviewMessage && <section className="mt-8 border-t border-border pt-6"><MessageEditor key={reviewMessage.id} message={reviewMessage} billId={billId} contactName={`${reviewMessage.sent_to ?? data.bill.issuer ?? "the vendor"} billing team`} /></section>}
    {needDraft && <Button variant="signal" className="mt-6" disabled={busy} onClick={draft}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}Write message</Button>}
    <AskQuestion billId={billId} />
  </main>;
}