import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, MicOff, PhoneOff, Send, Volume2 } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { supabase } from "@/integrations/supabase/client";
import { useLiveVoice, type LiveEvent } from "@/hooks/use-live-voice";
import { finishConversation, sendTextMessage } from "@/lib/conversations.functions";

export const Route = createFileRoute("/_authenticated/c/$conversationId")({
  head: () => ({
    meta: [
      { title: "Brumík AI" },
      { name: "description", content: "Brumík AI – tvoj osobný hlasový a textový spoločník, ktorý sa učí z rozhovorov." },
      { property: "og:title", content: "Brumík AI" },
      { property: "og:description", content: "Brumík AI – tvoj osobný hlasový a textový spoločník, ktorý sa učí z rozhovorov." },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://slovak-whisper-buddy.lovable.app/c/77d73564-2c40-47bc-b1ba-24db87433cba" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [
      { rel: "canonical", href: "https://slovak-whisper-buddy.lovable.app/c/77d73564-2c40-47bc-b1ba-24db87433cba" },
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
  const sendText = useServerFn(sendTextMessage);

  const [token, setToken] = useState<string | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "done" | "error">("idle");
  const [textInput, setTextInput] = useState("");
  const [isSending, setIsSending] = useState(false);

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

  // Zachováva prepis hovoru na pozadí pre funkciu finishConversation, ale nezobrazuje ho na obrazovke
  const onEvent = useCallback((event: LiveEvent) => {
    if (event.type === "session.input_transcript.delta" || event.type === "session.output_transcript.delta") {
      const role: Row["role"] = event.type === "session.input_transcript.delta" ? "user" : "assistant";
      const delta = typeof event["delta"] === "string" ? event["delta"] : "";
      if (!delta) return;
      const next = [...rowsRef.current];
      const last = next[next.length - 1];
      if (last && last.role === role) next[next.length - 1] = { role, text: last.text + delta };
      else next.push({ role, text: delta });
      rowsRef.current = next;
    } else if (event.type === "app.memory.saved") {
      const plan = event["plan"] as { memories?: string[] } | undefined;
      if (plan?.memories?.length) setNotes((n) => [...n, ...plan.memories!]);
    }
  }, []);

  const voice = useLiveVoice({ onEvent, startPayload: { token, conversationId } });
  const idle = voice.status === "idle" || voice.status === "closed";
  const live = voice.status === "connected";

  // 1. Wake Lock: Zabráni zhasnutiu displeja počas aktívneho hovoru
  useEffect(() => {
    if (!live || typeof navigator === "undefined" || !("wakeLock" in navigator)) return;
    let lock: any = null;

    const requestLock = async () => {
      try {
        lock = await (navigator as any).wakeLock.request("screen");
      } catch (err) {
        console.log("Wake Lock sa nepodarilo aktivovať:", err);
      }
    };

    requestLock();

    const handleVisibility = () => {
      if (document.visibilityState === "visible" && live) {
        requestLock();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      if (lock) lock.release().catch(() => {});
    };
  }, [live]);

  // 2. Media Session: Zobrazí Brumíka v multimediálnom ovládaní telefónu
  useEffect(() => {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;

    if (live) {
      try {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: "Brumík počúva",
          artist: "Živý rozhovor",
        });
        navigator.mediaSession.playbackState = "playing";
        navigator.mediaSession.setActionHandler("stop", () => {
          voice.stop();
        });
      } catch (e) {
        console.log("MediaSession chyba:", e);
      }
    } else {
      try {
        navigator.mediaSession.playbackState = "none";
      } catch (e) {}
    }
  }, [live, voice]);

  // Po skončení hovoru uloží prepis a vyextrahuje spomienky
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
        await Promise.all([
          qc.invalidateQueries({ queryKey: ["conversation", conversationId] }),
          qc.invalidateQueries({ queryKey: ["conversations"] }),
          qc.invalidateQueries({ queryKey: ["memories"] }),
        ]);
      })
      .catch(() => setSaveState("error"));
  }, [voice.status, conversationId, finish, qc]);

  const history = conversation?.entries ?? [];

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [history.length]);

  function start() {
    savedRef.current = false;
    rowsRef.current = [];
    setNotes([]);
    setSaveState("idle");
    voice.start();
  }

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!textInput.trim() || isSending) return;
    const msg = textInput.trim();
    setTextInput("");
    setIsSending(true);
    try {
      await sendText({ data: { conversationId, message: msg } });
      await qc.invalidateQueries({ queryKey: ["conversation", conversationId] });
    } finally {
      setIsSending(false);
    }
  }

  return (
    <main className="flex min-h-screen flex-1 flex-col">
      <audio ref={voice.audioRef} className="hidden" />
      <div className="px-6 pt-4 md:pt-8">
        <h1 className="truncate text-2xl md:text-3xl">{conversation?.conversation?.title ?? "Rozhovor"}</h1>
        {conversation?.conversation?.summary && (
          <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{conversation.conversation.summary}</p>
        )}
      </div>

      <section className="flex flex-col items-center px-6 py-6">
        <div className="relative flex h-36 w-36 items-center justify-center md:h-44 md:w-44">
          {live && <span className="animate-ring-pulse absolute inset-0 rounded-full border-2 border-glow" />}
          <span
            className={`orb block h-full w-full ${live ? "animate-orb-live" : "animate-orb-breathe"} ${
              voice.status === "connecting" ? "opacity-70" : ""
            }`}
          />
        </div>
        <p className="mt-4 h-5 text-sm text-muted-foreground" role="status">
          {voice.status === "connecting" && "Pripájam sa…"}
          {live && (voice.muted ? "Mikrofón je stlmený" : "Počúvam ťa")}
          {voice.status === "stopping" && "Ukončujem…"}
          {idle && saveState === "saving" && "Ukladám rozhovor a učím sa z neho…"}
          {idle && saveState === "done" && "Uložené. Zapamätal som si, čo bolo dôležité."}
          {idle && saveState === "error" && "Rozhovor sa nepodarilo uložiť."}
        </p>
        {voice.error && <p className="mt-2 max-w-sm text-center text-sm text-destructive" role="alert">{voice.error}</p>}

        <div className="mt-4 flex items-center gap-3">
          {idle ? (
            <button
              onClick={start}
              disabled={!token || saveState === "saving"}
              className="flex items-center gap-2 rounded-full bg-primary px-6 py-2.5 font-semibold text-primary-foreground transition hover:brightness-110 disabled:opacity-50"
            >
              <Mic className="h-5 w-5" /> {history.length ? "Pokračovať v hovore" : "Začať hovor"}
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
                className="flex items-center gap-2 rounded-full bg-destructive px-6 py-2.5 font-semibold text-destructive-foreground transition hover:brightness-110 disabled:opacity-50"
              >
                <PhoneOff className="h-5 w-5" /> Ukončiť
              </button>
            </>
          )}
          {voice.playbackBlocked && (
            <button onClick={voice.resumePlayback} className="flex items-center gap-2 rounded-full border px-4 py-2 text-sm">
              <Volume2 className="h-4 w-4" /> Pustiť zvuk
            </button>
          )}
        </div>
        {notes.length > 0 && (
          <div className="mt-4 flex max-w-md flex-wrap justify-center gap-2">
            {notes.map((n, i) => (
              <span key={i} className="rounded-full bg-user-bubble px-3 py-1 text-xs text-user-bubble-foreground">
                Zapamätané: {n}
              </span>
            ))}
          </div>
        )}
      </section>

      {/* História správ */}
      <section className="mx-auto w-full max-w-2xl flex-1 space-y-3 px-6 pb-28">
        {history.map((r, i) =>
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
        {isSending && (
          <p className="animate-pulse text-sm text-muted-foreground">Brumík píše…</p>
        )}
        <div ref={bottomRef} />
      </section>

      {/* Pole na písanie správ na spodku */}
      <div className="sticky bottom-0 border-t border-border/40 bg-background/80 p-4 backdrop-blur-md">
        <form onSubmit={handleSend} className="mx-auto flex max-w-2xl items-center gap-2">
          <input
            type="text"
            value={textInput}
            onChange={(e) => setTextInput(e.target.value)}
            placeholder="Napíš správu Brumíkovi…"
            disabled={isSending}
            className="flex-1 rounded-full border border-border/60 bg-secondary px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={isSending || !textInput.trim()}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-primary-foreground transition hover:brightness-110 disabled:opacity-50"
            aria-label="Odoslať správu"
          >
            <Send className="h-4 w-4" />
          </button>
        </form>
      </div>
    </main>
  );
}
