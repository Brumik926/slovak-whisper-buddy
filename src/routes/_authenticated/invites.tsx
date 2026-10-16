import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Mail, Trash2 } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/invites")({
  head: () => ({
    meta: [
      { title: "Pozvánky – Brumík" },
      { name: "description", content: "Pozvi ľudí, ktorí môžu mať vlastného Brumíka." },
      { property: "og:title", content: "Pozvánky – Brumík" },
      { property: "og:description", content: "Pozvi ľudí, ktorí môžu mať vlastného Brumíka." },
    ],
  }),
  component: Invites,
});

function Invites() {
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const { data: isAdmin } = useQuery({
    queryKey: ["is-admin"],
    queryFn: async () => (await supabase.rpc("is_admin")).data ?? false,
  });
  const { data } = useQuery({
    queryKey: ["invites"],
    enabled: !!isAdmin,
    queryFn: async () => {
      const { data, error } = await supabase.from("invites").select("email, created_at").order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const mailto = (to: string) => {
    const link = window.location.origin;
    const body = `Ahoj,\n\npozývam ťa k Brumíkovi – súkromnému hlasovému spoločníkovi, ktorý sa učí len pre teba.\n\nOtvor ${link} a prihlás sa cez Google s touto adresou (${to}).`;
    return `mailto:${to}?subject=${encodeURIComponent("Pozvánka k Brumíkovi")}&body=${encodeURIComponent(body)}`;
  };

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    const clean = email.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(clean)) return setError("Zadaj platný e-mail.");
    const { error } = await supabase.from("invites").insert({ email: clean });
    if (error && error.code !== "23505") return setError("Nepodarilo sa uložiť pozvánku.");
    setEmail("");
    await qc.invalidateQueries({ queryKey: ["invites"] });
    window.location.href = mailto(clean);
  };

  const remove = async (e: string) => {
    await supabase.from("invites").delete().eq("email", e);
    await qc.invalidateQueries({ queryKey: ["invites"] });
  };

  return (
    <AppShell>
      <main className="mx-auto w-full max-w-2xl px-6 py-10">
        <h1 className="text-4xl">Pozvánky</h1>
        {isAdmin === false ? (
          <p className="mt-4 text-muted-foreground">Pozývať môže len majiteľ aplikácie.</p>
        ) : (
          <>
            <p className="mt-2 text-muted-foreground">
              Prihlásiť sa môže len ten, koho e-mail tu pridáš. Každý pozvaný má vlastného Brumíka — tvoje rozhovory ani spomienky neuvidí.
            </p>
            <form onSubmit={add} className="mt-8 flex gap-2">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="meno@gmail.com"
                className="min-w-0 flex-1 rounded-full border bg-card/50 px-4 py-2.5 text-sm outline-none focus:border-primary"
              />
              <button className="rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:brightness-110">
                Pozvať
              </button>
            </form>
            {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
            <ul className="mt-8 space-y-2">
              {(data ?? []).map((i) => (
                <li key={i.email} className="flex items-center gap-3 rounded-2xl border bg-card/50 px-4 py-3">
                  <span className="min-w-0 flex-1 truncate">{i.email}</span>
                  <a href={mailto(i.email)} aria-label="Poslať e-mail znova" className="text-muted-foreground hover:text-foreground">
                    <Mail className="h-4 w-4" />
                  </a>
                  <button onClick={() => remove(i.email)} aria-label="Zrušiť pozvánku" className="text-muted-foreground hover:text-destructive">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </li>
              ))}
              {data?.length === 0 && <p className="text-sm text-muted-foreground">Zatiaľ nikto pozvaný.</p>}
            </ul>
          </>
        )}
      </main>
    </AppShell>
  );
}
