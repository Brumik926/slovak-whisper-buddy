import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { lovable } from "@/integrations/lovable/index";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/auth")({
  validateSearch: (s: Record<string, unknown>) => ({ denied: s["denied"] === 1 || s["denied"] === "1" ? 1 : undefined }),
  head: () => ({
    meta: [
      { title: "Prihlásenie – Lumen" },
      { name: "description", content: "Prihlás sa do svojho súkromného hlasového spoločníka." },
      { property: "og:title", content: "Prihlásenie – Lumen" },
      { property: "og:description", content: "Prihlás sa do svojho súkromného hlasového spoločníka." },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const { denied } = Route.useSearch();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(denied ? "Táto aplikácia je súkromná a patrí inému účtu." : null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (denied) return;
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/" });
    });
  }, [denied, navigate]);

  async function signIn() {
    setBusy(true);
    setError(null);
    const result = await lovable.auth.signInWithOAuth("google", { redirect_uri: window.location.origin });
    if (result.error) {
      setError("Prihlásenie sa nepodarilo. Skús to znova.");
      setBusy(false);
      return;
    }
    if (result.redirected) return;
    navigate({ to: "/" });
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6 text-center">
      <div className="orb animate-orb-breathe h-40 w-40" />
      <h1 className="mt-10 text-5xl">Lumen</h1>
      <p className="mt-3 max-w-xs text-muted-foreground">Tvoj súkromný hlasový spoločník, ktorý ťa postupne spoznáva.</p>
      <button
        onClick={signIn}
        disabled={busy}
        className="mt-10 rounded-full bg-primary px-7 py-3 font-semibold text-primary-foreground transition hover:brightness-110 disabled:opacity-60"
      >
        {busy ? "Prihlasujem…" : "Pokračovať cez Google"}
      </button>
      {error && <p className="mt-4 text-sm text-destructive">{error}</p>}
    </main>
  );
}
