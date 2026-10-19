import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { isAuthLink } from "@/lib/password-reset";

// Captured before the auth client consumes the link from the address bar.
const INITIAL_HASH = typeof window === "undefined" ? "" : window.location.hash;
const INITIAL_SEARCH = typeof window === "undefined" ? "" : window.location.search;

export const Route = createFileRoute("/reset-password")({
  head: () => ({
    meta: [
      { title: "Reset password — BillShield" },
      {
        name: "description",
        content: "Set a new password for your BillShield account using the link we emailed you.",
      },
      { property: "og:title", content: "Reset password — BillShield" },
      {
        property: "og:description",
        content: "Set a new password for your BillShield account.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const navigate = useNavigate();
  const [arrivedWithLink] = useState(() => isAuthLink(INITIAL_HASH, INITIAL_SEARCH));
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (password.length < 6) {
      toast.error("Choose a password of at least 6 characters.");
      return;
    }
    if (password !== confirm) {
      toast.error("Both passwords must match.");
      return;
    }
    setBusy(true);
    try {
      // Recovery sessions are exempt from the current-password requirement.
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      setDone(true);
      toast.success("Password updated.");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not update your password.";
      toast.error(
        /expired|invalid|session/i.test(message)
          ? "This reset link has expired. Please request a new one."
          : message,
      );
    } finally {
      setBusy(false);
    }
  }

  async function toSignIn() {
    await supabase.auth.signOut();
    navigate({ to: "/auth" });
  }

  return (
    <div className="min-h-screen">
      <AppHeader signedIn={false} />
      <div className="mx-auto max-w-sm px-4 py-16">
        <h1 className="text-2xl font-bold">Set a new password</h1>

        {done ? (
          <div className="mt-6 space-y-4 rounded-lg border border-border bg-card p-6 shadow-card">
            <p className="text-sm">
              Your password has been updated. Sign in with it to keep checking bills.
            </p>
            <Button type="button" className="w-full" onClick={toSignIn}>
              Go to sign in
            </Button>
          </div>
        ) : !arrivedWithLink ? (
          <div className="mt-6 space-y-4 rounded-lg border border-border bg-card p-6 shadow-card">
            <p className="text-sm">
              This reset link isn&apos;t valid or has expired, so there&apos;s nothing to change
              here yet.
            </p>
            <p className="text-sm text-muted-foreground">
              Request a fresh link from the sign-in page: enter your email, then choose{" "}
              <span className="font-medium text-foreground">Forgot password?</span>
            </p>
            <Button type="button" className="w-full" variant="outline" onClick={toSignIn}>
              Back to sign in
            </Button>
          </div>
        ) : (
          <form
            onSubmit={submit}
            className="mt-6 space-y-4 rounded-lg border border-border bg-card p-6 shadow-card"
          >
            <div className="space-y-1.5">
              <Label htmlFor="pw">New password</Label>
              <Input
                id="pw"
                type="password"
                required
                minLength={6}
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pw2">Repeat new password</Label>
              <Input
                id="pw2"
                type="password"
                required
                minLength={6}
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </div>
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? "Saving…" : "Save new password"}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
