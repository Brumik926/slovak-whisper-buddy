import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, MicOff, PhoneOff, Volume2 } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { supabase } from "@/integrations/supabase/client";
import { useLiveVoice, type LiveEvent } from "@/hooks/use-live-voice";
import { finishConversation } from "@/lib/conversations.functions";

export const Route = createFileRoute("/_authenticated/c/$conversationId")({
  head: () => ({
    meta: [
      { title: "Rozhovor – Lumen" },
      { name: "description", content: "Hlasový rozhovor s tvojím osobným spoločníkom." },
      { property: "og:title", content: "Rozhovor – Lumen" },
      { property: "og:description", content: "Hlasový rozhovor s tvojím osobným spoločníkom." },
    ],
  }),
  component: ConversationPage,
});

function ConversationPage() {
  const { conversationId } = Route.useParams();
  return (
    <AppShell>
      <Conversation key={conversationId} conversationId={conversationId} />
    </AppShell>
  );
}

type Row = { role: "user" | "assistant"; text: string };

function Conversation({ conversationId }: { conversationId: string }) {
  const qc = useQueryClient();
  const finish = useServerFn(finishConversation);
  const [token, setToken] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [notes, setNotes] = useState<string[]>([]);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "done" | "error">("idle");
  const rowsRef = useRef<Row[]>([]);
  const savedRef = useRef(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const { data: conversation } = useQuery({
    queryKey: ["conversation", conversationId],
    queryFn: async () => {
      const [{ data: c }, { data: entries }] = await Promise.all([
        supabase.from("conversations").select("id, title, summary").eq("id", conversationId).maybeSingle(),
        supabase
          .from("transcript_entries")
          .select("id, role, text")
          .eq("conversation_id", conversationId)
          .order("position", { ascending: true }),
      ]);
      return { conversation: c, entries: entries ?? [] };
    },
  });

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setToken(data.session?.access_token ?? null));
    const { data } = supabase.auth.onAuthStateChange((_e, session) => setToken(session?.access_token ?? null));
    return () => data.subscription.unsubscribe();
  }, []);

  const onEvent = useCallback((event: LiveEvent) => {
    if (event.type === "session.input_transcript.delta" || event.type === "session.output_transcript.delta") {
      const role: Row["role"] = event.type === "session.input_transcript.delta" ? "user" : "assistant";
      const delta = typeof event.delta === "string" ? event.delta : "";
      if (!delta) return;
      const next = [...rowsRef.current];
      const last = next[next.length - 1];
      if (last && last.role === role) next[next.length - 1] = { role, text: last.text + delta };
      else next.push({ role, text: delta });
      rowsRef.current = next;
      setRows(next);
    } else if (event.type === "app.memory.saved") {
      const plan = event.plan as { memories?: string[] } | undefined;
      if (plan?.memories?.length) setNotes((n) => [...n, ...plan.memories!]);
    }
  }, []);

  const voice = useLiveVoice({ onEvent, startPayload: { token, conversationId } });
  const idle = voice.status === "idle" || voice.status === "closed";
  const live = voice.status === "connected";

  // When a call ends, save the transcript and let the assistant learn from it.
  useEffect(() => {
    if (voice.status !== "closed" || savedRef.current) return;
    const entries = rowsRef.current.filter((r) => r.text.trim());
    if (!entries.length) return;
    savedRef.current = true;
    setSaveState("saving");
    finish({ data: { conversationId, entries } })
      .then(async () => {
        setSaveState("done");
        rowsRef.current = [];
        setRows([]);
        await Promise.all([
          qc.invalidateQueries({ queryKey: ["conversation", conversationId] }),
          qc.invalidateQueries({ queryKey: ["conversations"] }),
          qc.invalidateQueries({ queryKey: ["memories"] }),
        ]);
      })
      .catch(() => setSaveState("error"));
  }, [voice.status, conversationId, finish, qc]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [rows.length, rows[rows.length - 1]?.text.length]);

  function start() {
    savedRef.current = false;
    rowsRef.current = [];
    setRows([]);
    setNotes([]);
    setSaveState("idle");
    voice.start();
  }

  const history = conversation?.entries ?? [];
  const shown: Row[] = [...history.map((e) => ({ role: e.role as Row["role"], text: e.text })), ...rows];

  return (
    <main className="flex flex-1 flex-col">
      <audio ref={voice.audioRef} className="hidden" />
      <div className="px-6 pt-4 md:pt-8">
        <h1 className="truncate text-2xl md:text-3xl">{conversation?.conversation?.title ?? "Rozhovor"}</h1>
        {conversation?.conversation?.summary && (
          <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{conversation.conversation.summary}</p>
        )}
      </div>

      <section className="flex flex-col items-center px-6 py-8">
        <div className="relative flex h-44 w-44 items-center justify-center md:h-52 md:w-52">
          {live && <span className="animate-ring-pulse absolute inset-0 rounded-full border-2 border-glow" />}
          <span
            className={`orb block h-full w-full ${live ? "animate-orb-live" : "animate-orb-breathe"} ${
              voice.status === "connecting" ? "opacity-70" : ""
            }`}
          />
        </div>
        <p className="mt-6 h-5 text-sm text-muted-foreground" role="status">
          {voice.status === "connecting" && "Pripájam sa…"}
          {live && (voice.muted ? "Mikrofón je stlmený" : "Počúvam ťa")}
          {voice.status === "stopping" && "Ukončujem…"}
          {idle && saveState === "saving" && "Ukladám rozhovor a učím sa z neho…"}
          {idle && saveState === "done" && "Uložené. Zapamätal som si, čo bolo dôležité."}
          {idle && saveState === "error" && "Rozhovor sa nepodarilo uložiť."}
        </p>
        {voice.error && <p className="mt-2 max-w-sm text-center text-sm text-destructive" role="alert">{voice.error}</p>}

        <div className="mt-6 flex items-center gap-3">
          {idle ? (
            <button
              onClick={start}
              disabled={!token || saveState === "saving"}
              className="flex items-center gap-2 rounded-full bg-primary px-7 py-3 font-semibold text-primary-foreground transition hover:brightness-110 disabled:opacity-50"
            >
              <Mic className="h-5 w-5" /> {history.length ? "Pokračovať v rozhovore" : "Začať rozhovor"}
            </button>
          ) : (
            <>
              <button
                onClick={() => voice.setMuted(!voice.muted)}
                disabled={!live}
                aria-label={voice.muted ? "Zapnúť mikrofón" : "Stlmiť mikrofón"}
                className="rounded-full border bg-secondary p-3 text-secondary-foreground transition hover:bg-accent disabled:opacity-50"
              >
                {voice.muted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
              </button>
              <button
                onClick={voice.stop}
                disabled={voice.status === "stopping"}
                className="flex items-center gap-2 rounded-full bg-destructive px-6 py-3 font-semibold text-destructive-foreground transition hover:brightness-110 disabled:opacity-50"
              >
                <PhoneOff className="h-5 w-5" /> Ukončiť
              </button>
            </>
          )}
          {voice.playbackBlocked && (
            <button onClick={voice.resumePlayback} className="flex items-center gap-2 rounded-full border px-4 py-3 text-sm">
              <Volume2 className="h-4 w-4" /> Pustiť zvuk
            </button>
          )}
        </div>
        {notes.length > 0 && (
          <div className="mt-6 flex max-w-md flex-wrap justify-center gap-2">
            {notes.map((n, i) => (
              <span key={i} className="rounded-full bg-user-bubble px-3 py-1 text-xs text-user-bubble-foreground">
                Zapamätané: {n}
              </span>
            ))}
          </div>
        )}
      </section>

      <section className="mx-auto w-full max-w-2xl flex-1 space-y-3 px-6 pb-16">
        {shown.map((r, i) =>
          r.role === "user" ? (
            <div key={i} className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-user-bubble px-4 py-2.5 text-user-bubble-foreground">
              {r.text}
            </div>
          ) : (
            <p key={i} className="max-w-[90%] leading-relaxed text-foreground/90">
              {r.text}
            </p>
          ),
        )}
        <div ref={bottomRef} />
      </section>
    </main>
  );
}
