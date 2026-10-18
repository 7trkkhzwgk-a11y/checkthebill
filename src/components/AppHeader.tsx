import { Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

export function AppHeader({ signedIn }: { signedIn: boolean }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  async function signOut() {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }
  return (
    <header className="border-b border-border bg-card/70 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
        <Link to="/" className="flex items-center gap-2 font-bold tracking-tight">
          <ShieldCheck className="h-5 w-5 text-accent" /> BillShield
        </Link>
        {signedIn ? (
          <div className="flex items-center gap-2">
            <Button asChild size="sm" variant="ghost">
              <Link to="/new">New check</Link>
            </Button>
            <Button asChild size="sm" variant="ghost">
              <Link to="/history">History</Link>
            </Button>
            <Button size="sm" variant="outline" onClick={signOut}>
              Log out
            </Button>
          </div>
        ) : (
          <Button asChild size="sm">
            <Link to="/auth">Sign in</Link>
          </Button>
        )}
      </div>
    </header>
  );
}
