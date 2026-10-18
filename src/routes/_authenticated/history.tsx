import { createFileRoute, Link } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { CheckCircle2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { listChecks } from "@/lib/comparison.functions";
import { formatCurrency } from "@/lib/message-format";

const historyQuery = queryOptions({ queryKey: ["checks-history"], queryFn: () => listChecks() });

export const Route = createFileRoute("/_authenticated/history")({
  head: () => ({ meta: [
    { title: "Your past checks — BillShield" },
    { name: "description", content: "Every bill check you have run, with the flagged line, missing amount and message status." },
    { property: "og:title", content: "Your past checks — BillShield" },
    { property: "og:description", content: "Your past BillShield checks and their outcomes." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" },
  ] }),
  loader: ({ context }) => context.queryClient.ensureQueryData(historyQuery),
  component: HistoryPage,
  errorComponent: ({ error }) => <main className="mx-auto max-w-3xl px-4 py-12"><h1 className="text-2xl font-bold">Couldn't load your history</h1><p className="mt-4 text-muted-foreground">{error instanceof Error ? error.message : "Your checks could not be loaded."}</p><Button asChild variant="outline" className="mt-6"><Link to="/new">New check</Link></Button></main>,
});

function HistoryPage() {
  const { data: checks } = useSuspenseQuery(historyQuery);
  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <p className="font-mono text-xs uppercase text-muted-foreground">BillShield / History</p>
        <Button asChild variant="signal" size="sm"><Link to="/new">New check</Link></Button>
      </div>
      <h1 className="mt-6 text-3xl font-bold">Your past checks</h1>
      {checks.length === 0 ? (
        <p className="mt-6 text-muted-foreground">No checks yet. Upload a bill and a promise to run your first one.</p>
      ) : (
        <ul className="mt-8 divide-y divide-border border-y border-border">
          {checks.map((c) => {
            const missing = c.flagged?.missing_amount ?? c.flagged?.overcharge ?? null;
            return (
              <li key={c.id} className="py-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link to="/result/$billId" params={{ billId: c.id }} className="break-words font-semibold underline-offset-4 hover:underline">
                      {c.issuer ?? "Unnamed check"}
                    </Link>
                    <p className="mt-1 text-xs text-muted-foreground">{new Date(c.date).toLocaleDateString()}</p>
                  </div>
                  <div className="text-right text-sm">
                    {c.status === "flagged" ? <span className="font-medium text-destructive">Line flagged</span>
                      : c.status === "clear" ? <span className="text-success">All clear</span>
                      : c.status === "incomplete" ? <span className="text-muted-foreground">Needs more info</span>
                      : <span className="text-muted-foreground">Not confirmed</span>}
                    {missing !== null && <p className="mt-1 font-mono">{formatCurrency(missing, c.currency)} missing</p>}
                  </div>
                </div>
                {c.flagged?.flag_reason && <p className="mt-2 break-words text-sm text-muted-foreground">{c.flagged.flag_reason}</p>}
                <p className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                  {c.sent ? <><CheckCircle2 className="h-3.5 w-3.5 text-success" />Message sent{c.words_changed !== null && ` · Words changed: ${c.words_changed}`}</>
                    : c.declined ? <><X className="h-3.5 w-3.5" />Not sending</>
                    : <><X className="h-3.5 w-3.5" />Message not sent</>}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
