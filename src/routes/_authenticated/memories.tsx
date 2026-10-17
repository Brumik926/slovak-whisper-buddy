import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/memories")({
  head: () => ({
    meta: [
      { title: "Čo o mne vie – Brumík" },
      { name: "description", content: "Prehľad všetkého, čo sa tvoj spoločník o tebe naučil." },
      { property: "og:title", content: "Čo o mne vie – Brumík" },
      { property: "og:description", content: "Prehľad všetkého, čo sa tvoj spoločník o tebe naučil." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Memories,
});

function Memories() {
  const { data, isLoading } = useQuery({
    queryKey: ["memories"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("memories")
        .select("id, content, category, created_at")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
  const groups = new Map<string, NonNullable<typeof data>>();
  for (const m of data ?? []) groups.set(m.category, [...(groups.get(m.category) ?? []), m]);

  return (
    <AppShell>
      <main className="mx-auto w-full max-w-2xl px-6 py-10">
        <h1 className="text-4xl">Čo o tebe viem</h1>
        <p className="mt-2 text-muted-foreground">Toto som sa naučil z našich rozhovorov. Používam to, aby som ti odpovedal na mieru.</p>
        {isLoading && <p className="mt-10 text-muted-foreground">Načítavam…</p>}
        {data?.length === 0 && (
          <p className="mt-10 rounded-2xl border bg-card/50 p-6 text-muted-foreground">
            Zatiaľ nič. Porozprávaj sa so mnou a začnem si pamätať.
          </p>
        )}
        <div className="mt-8 space-y-8">
          {[...groups.entries()].map(([category, items]) => (
            <section key={category}>
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-widest text-primary">{category}</h2>
              <ul className="space-y-2">
                {items.map((m) => (
                  <li key={m.id} className="rounded-2xl border bg-card/50 px-4 py-3">
                    {m.content}
                    <div className="mt-1 text-xs text-muted-foreground">{new Date(m.created_at).toLocaleDateString("sk-SK")}</div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </main>
    </AppShell>
  );
}
