import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { Brain, LogOut, Menu, Plus, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

export const conversationsQuery = {
  queryKey: ["conversations"],
  queryFn: async () => {
    const { data, error } = await supabase
      .from("conversations")
      .select("id, title, summary, updated_at")
      .order("updated_at", { ascending: false });
    if (error) throw error;
    return data;
  },
};

export function useNewConversation() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  return async () => {
    const { data, error } = await supabase.from("conversations").insert({}).select("id").single();
    if (error || !data) return;
    await qc.invalidateQueries({ queryKey: ["conversations"] });
    navigate({ to: "/c/$conversationId", params: { conversationId: data.id } });
  };
}

export function AppShell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const { data: conversations } = useQuery(conversationsQuery);
  const params = useParams({ strict: false }) as { conversationId?: string };
  const newConversation = useNewConversation();

  const sidebar = (
    <nav className="flex h-full flex-col gap-4 p-4">
      <div className="flex items-center justify-between px-2 pt-2">
        <Link to="/" className="font-display text-2xl" onClick={() => setOpen(false)}>
          Brumík
        </Link>
        <button className="md:hidden" onClick={() => setOpen(false)} aria-label="Zavrieť menu">
          <X className="h-5 w-5" />
        </button>
      </div>
      <button
        onClick={() => {
          setOpen(false);
          void newConversation();
        }}
        className="flex items-center justify-center gap-2 rounded-full bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:brightness-110"
      >
        <Plus className="h-4 w-4" /> Nový rozhovor
      </button>
      <div className="-mx-1 flex-1 overflow-y-auto">
        {(conversations ?? []).map((c) => (
          <Link
            key={c.id}
            to="/c/$conversationId"
            params={{ conversationId: c.id }}
            onClick={() => setOpen(false)}
            className={`block rounded-xl px-3 py-2.5 text-sm transition hover:bg-accent ${
              params.conversationId === c.id ? "bg-accent text-foreground" : "text-muted-foreground"
            }`}
          >
            <div className="truncate font-medium text-foreground">{c.title}</div>
            <div className="text-xs">{new Date(c.updated_at).toLocaleDateString("sk-SK")}</div>
          </Link>
        ))}
        {conversations?.length === 0 && <p className="px-3 text-sm text-muted-foreground">Zatiaľ žiadne rozhovory.</p>}
      </div>
      <Link
        to="/memories"
        onClick={() => setOpen(false)}
        className="flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm text-muted-foreground transition hover:bg-accent hover:text-foreground"
      >
        <Brain className="h-4 w-4" /> Čo o mne vie
      </Link>
      <button
        onClick={() => supabase.auth.signOut()}
        className="flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm text-muted-foreground transition hover:bg-accent hover:text-foreground"
      >
        <LogOut className="h-4 w-4" /> Odhlásiť sa
      </button>
    </nav>
  );

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-72 shrink-0 border-r bg-card/40 md:block">
        <div className="sticky top-0 h-screen">{sidebar}</div>
      </aside>
      {open && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-background/70 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 border-r bg-card">{sidebar}</aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 px-4 py-3 md:hidden">
          <button onClick={() => setOpen(true)} aria-label="Otvoriť menu">
            <Menu className="h-6 w-6" />
          </button>
          <span className="font-display text-xl">Brumík</span>
        </header>
        {children}
      </div>
    </div>
  );
}
