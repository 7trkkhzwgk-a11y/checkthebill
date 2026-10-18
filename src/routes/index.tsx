import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { FileSearch, Flag, Send } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "BillShield — catch the line that doesn't add up" },
      { name: "description", content: "Compare a bill with what was promised, flag the mismatch, and send one ready message." },
      { property: "og:title", content: "BillShield" },
      { property: "og:description", content: "Compare a bill with what was promised and flag the mismatch." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function Index() {
  const [signedIn, setSignedIn] = useState(false);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSignedIn(!!data.session));
  }, []);
  const steps = [
    { icon: FileSearch, t: "Upload two files", d: "The bill, and the promise — refund, contract or price list." },
    { icon: Flag, t: "Spot the mismatch", d: "Every line is read out for you to confirm first." },
    { icon: Send, t: "Send one message", d: "A ready-to-send note citing the exact line." },
  ];
  return (
    <div className="min-h-screen">
      <AppHeader signedIn={signedIn} />
      <section className="bg-ink text-primary-foreground">
        <div className="mx-auto max-w-5xl px-4 py-20 md:py-28">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-accent">Bill vs. promise</p>
          <h1 className="mt-4 max-w-2xl text-4xl font-bold leading-tight md:text-6xl">
            Find the line that doesn't add up.
          </h1>
          <p className="mt-5 max-w-xl text-lg opacity-80">
            BillShield reads your bill and what you were promised, side by side — then helps you ask for what you're owed.
          </p>
          <Button asChild variant="signal" size="lg" className="mt-8">
            <Link to={signedIn ? "/new" : "/auth"}>Start a check</Link>
          </Button>
        </div>
      </section>
      <section className="mx-auto grid max-w-5xl gap-4 px-4 py-14 md:grid-cols-3">
        {steps.map((s, i) => (
          <div key={s.t} className="rounded-lg border border-border bg-card p-6 shadow-card">
            <span className="font-mono text-xs text-muted-foreground">0{i + 1}</span>
            <s.icon className="mt-3 h-6 w-6 text-accent" />
            <h3 className="mt-3 font-semibold">{s.t}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{s.d}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
