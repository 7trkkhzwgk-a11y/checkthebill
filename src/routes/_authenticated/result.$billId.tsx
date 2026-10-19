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
import type { Finding } from "@/lib/comparison";
import { DRAFT_VERSION, formatCurrency } from "@/lib/message-format";
import type { Tables } from "@/integrations/supabase/types";

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
  const missingDraft = comparison.findings.some((f) => f.flagged && !data.messages.some((m) => m.line_id === f.line_id));
  const outdatedDraft = data.messages.some((m) => !m.sent && !m.declined_at && m.final_text === null && m.draft_version !== DRAFT_VERSION);
  return <main className="mx-auto max-w-3xl px-4 py-10"><div className="flex flex-wrap items-center justify-between gap-4"><p className="font-mono text-xs uppercase text-muted-foreground">BillShield / Check result</p><Button asChild variant="outline" size="sm"><Link to="/new">New check</Link></Button></div>
    <div className="mt-8 flex items-start gap-3">{comparison.status === "clear" ? <CheckCircle2 className="mt-1 h-7 w-7 shrink-0 text-success" /> : <AlertTriangle className="mt-1 h-7 w-7 shrink-0 text-destructive" />}<div className="min-w-0"><h1 className="text-3xl font-bold">{comparison.status === "clear" ? "Nothing wrong with this bill" : comparison.status === "flagged" ? "This line doesn't add up" : "This check needs more information"}</h1>{data.bill.issuer && <p className="mt-2 break-words text-muted-foreground">{data.bill.issuer}</p>}<p className="mt-2 text-xs text-muted-foreground">Checked on {comparison.checked_on}</p></div></div>
    {comparison.issues.length > 0 && <div className="mt-6 border-l-2 border-accent pl-4"><h2 className="font-semibold">Not fully checked</h2>{comparison.issues.map((issue) => <p key={issue} className="mt-2 break-words text-sm text-muted-foreground">{issue}</p>)}</div>}
    {comparison.findings.map((f, i) => {
      const line = data.lines.find((l) => l.id === f.line_id);
      const message = data.messages.find((m) => m.line_id === f.line_id);
      return <section key={`${f.promise_id}-${f.line_id ?? i}`} className="mt-8 border-t border-border pt-6">
        {line && <div className={`border-l-4 p-4 ${f.flagged ? "border-destructive bg-destructive/10" : "border-success bg-success/10"}`}><h2 className="break-words font-semibold">{line.description || "Transaction"}</h2><div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 font-mono text-sm"><span>{formatCurrency(line.amount, f.currency)}</span><span>{line.type}</span>{line.date && <span>{line.date}</span>}</div>{line.reference_no && <p className="mt-2 break-all font-mono text-xs">Reference: {line.reference_no}</p>}{f.flag_reason && <p className="mt-3 text-sm">{f.flag_reason}</p>}{f.note && <p className="mt-3 text-sm text-muted-foreground">{f.note}</p>}</div>}
        <Maths finding={f} />
        {f.contact_reason && <div className="mt-5"><h3 className="font-semibold">Who to contact and why</h3><p className="mt-2 text-sm leading-relaxed">{f.contact_reason}</p></div>}
        {message && f.flagged && <MessageEditor key={`${message.id}-${message.draft_version}`} message={message} billId={billId} contactName={f.contact_name ?? (f.recipient === "BANK" ? "your bank" : "the billing company")} />}
      </section>;
    })}
    {(missingDraft || outdatedDraft) && <Button variant="signal" className="mt-6" disabled={busy} onClick={draft}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}{outdatedDraft ? "Update message" : "Write message"}</Button>}
    <AskQuestion billId={billId} />
  </main>;
}