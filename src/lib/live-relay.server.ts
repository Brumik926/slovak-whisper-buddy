import { createOpenAI } from "@ai-sdk/openai";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { stepCountIs, streamText, tool, type ModelMessage } from "ai";
import process from "node:process";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";

export type LiveConfig = {
  baseURL: string;
  key: string;
  liveModel: string;
  backendModel: string;
  supabaseUrl: string;
  supabaseKey: string;
  openingInstructions?: string;
};

const liveSettings = {
  baseURL: "https://ai.gateway.lovable.dev/v1",
  liveModel: "openai/gpt-live-1",
  backendModel: "openai/gpt-6-astra",
};

export type LiveSocket = {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onMessage(handler: (data: unknown) => void): void;
  onClose(handler: () => void): void;
  onError(handler: () => void): void;
};

export type LiveExecutionContext = { waitUntil(task: Promise<unknown>): void };
export type LiveConnector = (url: string, headers: Record<string, string>, signal: AbortSignal) => Promise<LiveSocket>;

type WorkerSocket = WebSocket & { accept(): void };
declare const WebSocketPair: { new (): { 0: WorkerSocket; 1: WorkerSocket } };
type Transcript = {
  role: "user" | "assistant";
  text: string;
  start_ms: number;
  end_ms: number;
  listeningSound: boolean;
};
type ProviderEvent = {
  type: string;
  client_event_id?: string;
  error?: { client_event_id?: string; message?: string };
  session?: { id: string };
  delta?: string;
  start_ms?: number;
  end_ms?: number;
  offset_ms?: number;
  delegation?: { id: string; target: string };
};

export function getLiveConfig(): LiveConfig {
  const config: LiveConfig = {
    ...liveSettings,
    key: process.env["LOVABLE_API_KEY"] ?? "",
    supabaseUrl: process.env["SUPABASE_URL"] ?? "",
    supabaseKey: process.env["SUPABASE_PUBLISHABLE_KEY"] ?? "",
    openingInstructions:
      "Začni rozhovor po slovensky: krátko a srdečne pozdrav, prípadne nadviaž na niečo, čo o ňom vieš, a polož jednu otázku. Potom počúvaj.",
  };
  if (
    [config.baseURL, config.key, config.liveModel, config.backendModel, config.supabaseUrl, config.supabaseKey].some(
      (value) => !value,
    )
  ) {
    throw new Error("Missing Live relay configuration");
  }
  return config;
}

function gatewayAPIBase(baseURL: string) {
  return `${baseURL.replace(/\/+$/, "").replace(/\/v1$/, "")}/v1`;
}

async function gatewayRejection(response: Response) {
  const body = (await response.json().catch(() => null)) as { message?: unknown } | null;
  const message = typeof body?.message === "string" ? body.message.slice(0, 300) : "";
  return new Error(message || `Voice gateway rejected the connection (${response.status})`);
}

export function validateLiveUpgrade(request: Request, options: { allowMissingOrigin?: boolean } = {}): Response | null {
  const origin = request.headers.get("origin");
  if (origin === null ? !options.allowMissingOrigin : origin !== new URL(request.url).origin) {
    return new Response("Voice connection origin rejected", { status: 403 });
  }
  if (request.method !== "GET" || request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
    return new Response("WebSocket required", { status: 426 });
  }
  return null;
}

function workerSocket(socket: WorkerSocket): LiveSocket {
  return {
    get readyState() {
      return socket.readyState;
    },
    send: (data) => socket.send(data),
    close: (code, reason) => socket.close(code, reason),
    onMessage: (handler) => socket.addEventListener("message", (event) => handler(event.data)),
    onClose: (handler) => socket.addEventListener("close", handler),
    onError: (handler) => socket.addEventListener("error", handler),
  };
}

export function handleLiveRequest(request: Request): Response {
  const waitUntil = (request as Request & Partial<LiveExecutionContext>).waitUntil;
  if (!waitUntil) return new Response("Live runtime unavailable", { status: 503 });
  const config = getLiveConfig();
  const rejected = validateLiveUpgrade(request);
  if (rejected) return rejected;
  const pair = new WebSocketPair();
  pair[1].accept();
  bindLiveConnection(workerSocket(pair[1]), config, { waitUntil }, async (url, headers, signal) => {
    const response = await fetch(url, { headers: { ...headers, Upgrade: "websocket" }, signal });
    const socket = (response as Response & { webSocket?: WorkerSocket | null }).webSocket;
    if (!socket) throw await gatewayRejection(response);
    socket.accept();
    return workerSocket(socket);
  });
  const response: ResponseInit & { webSocket: WebSocket } = { status: 101, webSocket: pair[0] };
  return new Response(null, response);
}

type PlanNote = { memories: string[] };

export type PersonalContext = {
  supabase: SupabaseClient<Database>;
  userId: string;
  conversationId: string;
  instructions: string;
};

function baseInstructions(memories: string[], summaries: string[], currentSummary: string | null) {
  const memoryBlock = memories.length
    ? memories.map((m) => `- ${m}`).join("\n")
    : "- Zatiaľ nič. Spoznávaj ho prirodzene a buduj si s ním vzťah.";
  const pastBlock = summaries.length ? summaries.map((s) => `- ${s}`).join("\n") : "- Toto je váš prvý rozhovor.";
  return `Si Brumík, osobný inteligentný hlasový spoločník a priateľ. Hovoríš výhradne po slovensky, prirodzene, teplo, pohotovo a živo.
Máš všestranný rozhľad a bohaté znalosti o svete, technológiách, vede, práci, filozofii aj bežnom živote. Keď sa ťa používateľ na čokoľvek opýta, vždy mu priamo, vecne a zaujímavo odpovedz, vysvetli danú tému alebo ponúkni svoj pohľad.

PRAVIDLÁ PRE ODPOVEDE:
- NIKDY neodpovedaj vyhýbavo ani pasívne frázami typu „To si zatiaľ nevysvetlil“, „O tom si mi ešte nehovoril“ alebo „To nemám v pamäti“. Tvoja inteligencia a vedomosti nie sú obmedzené len na uložené spomienky!
- Ak používateľ položí otázku na akúkoľvek tému, pojem, názor, radu či bežný rozhovor, plnohodnotne a múdro odpovedz zo svojich všeobecných znalostí.
- Odpovedaj stručne a svižne ako v skutočnom živom hovore (zvyčajne 1 až 3 vety), aby konverzácia plynula a nebola z toho dlhá prednáška.

Čo o ňom vieš z minulosti (použi na personalizáciu a zblíženie, nie ako obmedzenie):
${memoryBlock}

Predchádzajúce rozhovory:
${pastBlock}
${currentSummary ? `\nTento rozhovor pokračuje, doteraz: ${currentSummary}\n` : ""}
Backchannel policy: Používaj mierne zvuky počúvania (hm, aha) bez preberania slova.
Interruption policy: Keď ťa preruší, prestaň hovoriť a počúvaj.
Delegation policy:
Backend tools: Uložiť nový trvalý poznatok o používateľovi; vyhľadať v minulých rozhovoroch.
Delegate to the backend when: Používateľ ťa požiada, aby si si niečo zapamätal, alebo zdieľa dôležitý trvalý fakt či preferenciu o sebe; alebo sa pýta na niečo, o čom ste hovorili v minulosti a nie je to vyššie.
Do not delegate to the backend when: Pozdrav, bežný rozhovor, otázka, na ktorú vieš odpovedať sám. Pred potvrdením, že si si niečo uložil, počkaj na výsledok z backendu.`;
}

export async function authorizeOwner(config: LiveConfig, token: unknown, conversationID: unknown): Promise<PersonalContext> {
  if (typeof token !== "string" || token.split(".").length !== 3) throw new Error("Prihlás sa, prosím.");
  if (typeof conversationID !== "string" || !/^[0-9a-f-]{36}$/i.test(conversationID)) {
    throw new Error("Neplatný rozhovor.");
  }
  const key = config.supabaseKey;
  const supabase = createClient<Database>(config.supabaseUrl, key, {
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
    global: {
      headers: { Authorization: `Bearer ${token}` },
      fetch: (input, init) => {
        const headers = new Headers(init?.headers);
        headers.set("apikey", key);
        return fetch(input, { ...init, headers });
      },
    },
  });
  const { data: claims, error } = await supabase.auth.getClaims(token);
  const userId = claims?.claims?.sub;
  if (error || !userId) throw new Error("Prihlásenie vypršalo. Prihlás sa znova.");
  const { data: owner } = await supabase.rpc("is_owner");
  if (!owner) throw new Error("Táto aplikácia je súkromná.");
  const [{ data: conversation }, { data: memories }, { data: past }] = await Promise.all([
    supabase.from("conversations").select("id, summary").eq("id", conversationID).maybeSingle(),
    supabase.from("memories").select("content").order("created_at", { ascending: false }).limit(80),
    supabase
      .from("conversations")
      .select("title, summary, created_at")
      .neq("id", conversationID)
      .not("summary", "is", null)
      .order("updated_at", { ascending: false })
      .limit(6),
  ]);
  if (!conversation) throw new Error("Rozhovor sa nenašiel.");
  return {
    supabase,
    userId,
    conversationId: conversationID,
    instructions: baseInstructions(
      (memories ?? []).map((m) => m.content).reverse(),
      (past ?? []).map((p) => `${new Date(p.created_at).toLocaleDateString("sk-SK")} – ${p.title}: ${p.summary}`),
      conversation.summary,
    ),
  };
}

const rememberInput = z.object({
  facts: z.array(
    z.object({
      content: z.string().describe("Krátky poznatok o používateľovi v tretej osobe, po slovensky."),
      category: z.enum(["fakt", "preferencia", "záujem", "cieľ", "štýl"]),
    }),
  ),
});
const searchInput = z.object({ query: z.string().describe("Jedno alebo dve kľúčové slová po slovensky.") });

function isListeningSound(text: string) {
  const normalized = text.toLowerCase().replace(/[\s\p{Pd}]/gu, "");
  return /^(?:m+hm+|uhhuh|hm+|aha)[.,!]*$/.test(normalized);
}

async function answerQuestion(
  messages: ModelMessage[],
  config: LiveConfig,
  correlation: { runID: string; sessionID: string | undefined; delegationID: string },
  signal: AbortSignal,
  consumeInput: () => void,
  personal: PersonalContext,
  onPlan: (plan: PlanNote) => void,
) {
  signal.throwIfAborted();
  const provider = createOpenAI({
    baseURL: gatewayAPIBase(config.baseURL),
    apiKey: config.key,
    headers: {
      "Lovable-API-Key": config.key,
      "X-Lovable-AIG-SDK": "vercel-ai-sdk",
    },
  });
  let responseCursor = 0;
  consumeInput();
  const result = streamText({
    model: provider.responses(config.backendModel),
    abortSignal: signal,
    maxRetries: 0,
    stopWhen: stepCountIs(50),
    includeRawChunks: true,
    prepareStep() {
      consumeInput();
      return { messages: [...messages] };
    },
    onStepFinish(step) {
      messages.push(...step.response.messages.slice(responseCursor));
      responseCursor = step.response.messages.length;
    },
    headers: {
      "X-Lovable-AIG-Run-ID": correlation.runID,
      "X-Lovable-AIG-Metadata": JSON.stringify({
        live_session_id: correlation.sessionID,
        delegation_id: correlation.delegationID,
      }),
    },
    providerOptions: {
      openai: {
        store: false,
        ...(config.backendModel !== "openai/chat-latest"
          ? {
              forceReasoning: true,
              reasoningEffort: "low",
              reasoningSummary: "auto",
              include: ["reasoning.encrypted_content"],
            }
          : {}),
      },
    },
    system:
      "Pomáhaš hlasovému osobnému spoločníkovi. Prepisy môžu byť neúplné alebo opravené; ber do úvahy poslednú opravu. " +
      "Ak používateľ chce, aby si si niečo zapamätal, alebo prezradil trvalý fakt či preferenciu, zavolaj remember_facts. " +
      "Ak sa pýta na minulé rozhovory, zavolaj search_past_conversations. Neopakuj už dokončené akcie. " +
      "Odpovedz po slovensky, max 80 slov, ako podklad pre hovorenú odpoveď. Tvrď, že si niečo uložil, len ak to nástroj potvrdil.",
    messages,
    tools: {
      remember_facts: tool({
        description: "Uloží jeden alebo viac trvalých poznatkov o používateľovi.",
        inputSchema: rememberInput,
        execute: async ({ facts }) => {
          signal.throwIfAborted();
          const rows = facts
            .map((f) => ({ content: f.content.trim().slice(0, 300), category: f.category }))
            .filter((f) => f.content)
            .slice(0, 10)
            .map((f) => ({ ...f, user_id: personal.userId, source_conversation_id: personal.conversationId }));
          if (!rows.length) return { saved: [] };
          const { error } = await personal.supabase.from("memories").insert(rows);
          if (error) return { saved: [], error: "Uloženie zlyhalo." };
          onPlan({ memories: rows.map((r) => r.content) });
          return { saved: rows.map((r) => r.content) };
        },
      }),
      search_past_conversations: tool({
        description: "Vyhľadá v minulých rozhovoroch a ich súhrnoch.",
        inputSchema: searchInput,
        execute: async ({ query }) => {
          signal.throwIfAborted();
          const q = query.replace(/[%_,()]/g, " ").trim().slice(0, 60);
          if (!q) return { results: [] };
          const [{ data: convs }, { data: lines }] = await Promise.all([
            personal.supabase
              .from("conversations")
              .select("title, summary, created_at")
              .or(`title.ilike.%${q}%,summary.ilike.%${q}%`)
              .limit(5),
            personal.supabase
              .from("transcript_entries")
              .select("role, text, created_at")
              .ilike("text", `%${q}%`)
              .order("created_at", { ascending: false })
              .limit(8),
          ]);
          return {
            conversations: (convs ?? []).map((c) => ({ date: c.created_at.slice(0, 10), title: c.title, summary: c.summary })),
            lines: (lines ?? []).map((l) => ({ date: l.created_at.slice(0, 10), role: l.role, text: l.text.slice(0, 300) })),
          };
        },
      }),
    },
  });
  let completed = false;
  let stepCompleted = false;
  let failed = false;
  // Drain through HTTP EOF so successful work is not recorded as cancelled by the Gateway.
  for await (const part of result.fullStream) {
    if (part.type === "start-step") stepCompleted = false;
    if (part.type === "raw" && part.rawValue && typeof part.rawValue === "object" && "type" in part.rawValue) {
      if (part.rawValue.type === "response.completed") stepCompleted = true;
      if (part.rawValue.type === "response.failed" || part.rawValue.type === "response.incomplete") failed = true;
    }
    if (part.type === "finish-step" && !stepCompleted) failed = true;
    if (part.type === "error" || part.type === "abort") failed = true;
    if (part.type === "finish") completed = part.finishReason === "stop";
  }
  signal.throwIfAborted();
  if (failed || !completed) throw new Error("The backend response did not complete");
  const answer = await result.text;
  if (!answer.trim()) throw new Error("The backend response had no answer");
  return answer;
}

function* commentaryChunks(content: string) {
  const encoder = new TextEncoder();
  let chunk = "";
  let bytes = 0;
  for (const [word] of content.matchAll(/\S+\s*|\s+/gu)) {
    // Chunks stay well inside the provider's per-append size limit.
    if (chunk && bytes + encoder.encode(word).length > 480) {
      yield chunk;
      chunk = "";
      bytes = 0;
    }
    for (const character of word) {
      const size = encoder.encode(character).length;
      if (bytes + size > 480) {
        yield chunk;
        chunk = "";
        bytes = 0;
      }
      chunk += character;
      bytes += size;
    }
  }
  if (chunk) yield chunk;
}

export function bindLiveConnection(
  browser: LiveSocket,
  configuration: LiveConfig,
  execution: LiveExecutionContext,
  connect: LiveConnector,
): void {
  const config = { ...configuration };
  const runID = crypto.randomUUID();
  let personal: PersonalContext | undefined;
  const setupAbort = new AbortController();
  let gateway: LiveSocket | undefined;
  let sessionID: string | undefined;
  let starting = false;
  let closing = false;
  let finished = false;
  let revision = 0;
  let task: AbortController | undefined;
  const pendingDelegations: Array<{
    event: ProviderEvent;
    plan?: PlanNote;
  }> = [];
  let completedDelegation: (typeof pendingDelegations)[number] | undefined;
  const backendMessages: ModelMessage[] = [];
  let transcriptCursor = 0;
  let restartTimer: ReturnType<typeof setTimeout> | undefined;
  let startupTimer: ReturnType<typeof setTimeout> | undefined;
  let closeTimer: ReturnType<typeof setTimeout> | undefined;
  let finishDrain: (() => void) | undefined;
  let browserReady = false;
  let greetingRequested = false;
  let greetingCommand: { id: string; type: "instructions" | "commentary" } | undefined;
  let greetingTimer: ReturnType<typeof setTimeout> | undefined;
  const startTimer = setTimeout(() => {
    emit({ type: "app.error", error: { message: "Voice startup message timed out" } });
    stop();
  }, 5000);
  const transcripts: Transcript[] = [];
  const delegations = new Set<string>();

  function emit(event: object) {
    if (browser.readyState !== 1) return;
    try {
      browser.send(JSON.stringify(event));
    } catch {
      stop();
    }
  }

  function close(socket?: LiveSocket) {
    if (!socket || socket.readyState === 3) return;
    try {
      socket.close(1000, "Call ended");
    } catch {
      return;
    }
  }

  function clearGreeting() {
    clearTimeout(greetingTimer);
    greetingCommand = undefined;
  }

  function requestGreeting() {
    const content = (
      config.openingInstructions ??
      "Start the conversation now in your configured language and role. Give a brief greeting suited to this app's purpose, ask one relevant opening question, then listen."
    ).trim();
    if (!content || !browserReady || !sessionID || greetingRequested || closing) return;
    greetingRequested = true;
    if (new TextEncoder().encode(content).length > 480) {
      emit({ type: "app.greeting.error", error: { message: "The opening instructions are too long" } });
      return;
    }
    greetingCommand = { id: crypto.randomUUID(), type: "instructions" };
    greetingTimer = setTimeout(() => {
      clearGreeting();
      emit({ type: "app.greeting.error", error: { message: "The opening could not be confirmed" } });
    }, 10_000);
    gateway?.send(
      JSON.stringify({
        type: "session.instructions.append",
        event_id: greetingCommand.id,
        delegation_id: null,
        content,
      }),
    );
  }

  function discardPendingWork() {
    pendingDelegations.length = 0;
    completedDelegation = undefined;
    clearTimeout(restartTimer);
    task?.abort();
  }

  function finish() {
    if (finished) return;
    finished = closing = true;
    clearTimeout(startTimer);
    clearTimeout(startupTimer);
    clearTimeout(closeTimer);
    clearTimeout(restartTimer);
    clearGreeting();
    discardPendingWork();
    setupAbort.abort();
    close(gateway);
    close(browser);
    finishDrain?.();
  }

  function stop() {
    if (closing) return;
    closing = true;
    discardPendingWork();
    clearTimeout(startupTimer);
    clearTimeout(startTimer);
    clearGreeting();
    if (gateway?.readyState === 1) {
      execution.waitUntil(
        new Promise<void>((resolve) => {
          finishDrain = resolve;
        }),
      );
      closeTimer = setTimeout(finish, 15_000);
      try {
        gateway.send(JSON.stringify({ type: "session.close" }));
      } catch {
        finish();
      }
    } else {
      finish();
    }
  }

  function scheduleDelegation() {
    clearTimeout(restartTimer);
    if (closing || task || pendingDelegations.length === 0) return;
    restartTimer = setTimeout(() => void runDelegation(), 300);
  }

  function deliverResult(delegationID: string, answer: string, plan?: PlanNote) {
    if (closing) return;
    if (gateway?.readyState !== 1) return stop();
    try {
      for (const content of commentaryChunks(answer)) {
        gateway.send(
          JSON.stringify({
            type: "session.commentary.append",
            event_id: crypto.randomUUID(),
            delegation_id: delegationID,
            content,
          }),
        );
      }
      void plan;
      completedDelegation = pendingDelegations.shift();
    } catch {
      stop();
    }
  }

  async function runDelegation() {
    const pending = pendingDelegations[0];
    const event = pending?.event;
    const id = event?.delegation?.id;
    if (!pending || !event || !id || closing || task) return;
    if (!transcripts.some(({ role, text }) => role === "user" && text.trim())) return;
    const controller = new AbortController();
    task = controller;
    let taskRevision = revision;
    try {
      if (!personal) throw new Error("Not authorized");
      const answer = await answerQuestion(
        backendMessages,
        config,
        { runID, sessionID, delegationID: id },
        controller.signal,
        () => {
          const updates = transcripts.slice(transcriptCursor);
          backendMessages.push(...updates.map(({ role, text }) => ({ role, content: text })));
          transcriptCursor = transcripts.length;
          taskRevision = revision;
        },
        personal,
        (plan) => {
          pending.plan = { memories: [...(pending.plan?.memories ?? []), ...plan.memories] };
          // Saved memories are durable writes: show them right away regardless of later revisions.
          emit({ type: "app.memory.saved", delegation_id: id, plan });
        },
      );
      if (closing || controller.signal.aborted) return;
      if (taskRevision !== revision) return;
      deliverResult(id, answer.trim(), pending.plan);
    } catch {
      if (closing || controller.signal.aborted) return;
      backendMessages.push({
        role: "assistant",
        content:
          "The backend attempt failed. Completed tool results remain valid; verify uncertain external actions before any retry.",
      });
      if (taskRevision !== revision) return;
      deliverResult(id, "The backend could not finish the answer. Ask whether the user wants to try again.");
    } finally {
      if (task === controller) task = undefined;
      scheduleDelegation();
    }
  }

  function queueDelegation(event: ProviderEvent) {
    pendingDelegations.push({ event });
    emit({ type: "app.delegation.pending", delegation_id: event.delegation?.id });
    scheduleDelegation();
  }

  function receiveGateway(data: unknown) {
    try {
      if (typeof data !== "string" || data.length > 1024 * 1024) throw new Error("Invalid voice event");
      const event: ProviderEvent = JSON.parse(data);
      if (browser.readyState === 1) browser.send(data);
      if (event.type === "session.closed") return finish();
      if (event.type === "gateway.session.closing" || event.type === "gateway.error" || event.type === "app.error") {
        return stop();
      }
      if (closing) return;
      if (event.type === "gateway.session.created") {
        sessionID = event.session?.id;
        clearTimeout(startupTimer);
        requestGreeting();
      }
      if (
        greetingCommand &&
        event.type === `session.${greetingCommand.type}.appended` &&
        event.client_event_id === greetingCommand.id
      ) {
        if (greetingCommand.type === "instructions") {
          greetingCommand = { id: crypto.randomUUID(), type: "commentary" };
          gateway?.send(
            JSON.stringify({
              type: "session.commentary.append",
              event_id: greetingCommand.id,
              delegation_id: null,
              content: "Begin the conversation now, following the instructions provided.",
            }),
          );
        } else {
          clearGreeting();
          emit({ type: "app.greeting.accepted" });
        }
      } else if (greetingCommand && event.type === "error" && event.error?.client_event_id === greetingCommand.id) {
        clearGreeting();
        emit({ type: "app.greeting.error", error: { message: event.error.message ?? "The opening was rejected" } });
      }
      if (event.type === "session.input_transcript.delta" || event.type === "session.output_transcript.delta") {
        const role = event.type === "session.input_transcript.delta" ? "user" : "assistant";
        if (!event.delta?.trim()) return;
        const listeningSound = role === "user" && Boolean(task) && isListeningSound(event.delta);
        transcripts.push({
          role,
          text: event.delta,
          start_ms: event.start_ms ?? 0,
          end_ms: event.end_ms ?? 0,
          listeningSound,
        });
        if (listeningSound) return;
        if (role === "user") {
          revision++;
          const offset = completedDelegation?.event.offset_ms;
          // Live has no transcript watermark; completed handoffs can receive late context.
          if (
            pendingDelegations.length === 0 &&
            completedDelegation &&
            typeof offset === "number" &&
            Number.isFinite(offset) &&
            offset >= 0 &&
            typeof event.start_ms === "number" &&
            Number.isFinite(event.start_ms) &&
            event.start_ms >= 0 &&
            event.start_ms <= offset
          ) {
            pendingDelegations.push(completedDelegation);
            completedDelegation = undefined;
          }
          if (pendingDelegations.length) {
            emit({ type: "app.delegation.pending", delegation_id: pendingDelegations[0]?.event.delegation?.id });
          }
        }
        scheduleDelegation();
      } else if (event.type === "session.delegation.created") {
        const id = event.delegation?.id;
        if (id && event.delegation?.target === "client" && !delegations.has(id)) {
          delegations.add(id);
          queueDelegation(event);
        }
      }
    } catch {
      emit({ type: "app.error", error: { message: "Invalid voice event or lost connection" } });
      stop();
    }
  }

  async function startSession(sdp: string, token: unknown, conversationID: unknown) {
    if (closing || browser.readyState !== 1) return;
    clearTimeout(startTimer);
    startupTimer = setTimeout(() => {
      emit({ type: "app.error", error: { message: "Voice startup timed out" } });
      stop();
    }, 40_000);
    // Private app: verify the signed-in owner before opening a paid Gateway session.
    personal = await authorizeOwner(config, token, conversationID);
    if (closing || browser.readyState !== 1) return;
    const accepted = await connect(
      new URL(`${gatewayAPIBase(config.baseURL)}/live/sessions`).href,
      {
        "Lovable-API-Key": config.key,
        "X-Lovable-AIG-SDK": "fetch",
        "X-Lovable-AIG-Run-ID": runID,
      },
      setupAbort.signal,
    );
    if (closing || browser.readyState !== 1) {
      close(accepted);
      return;
    }
    gateway = accepted;
    gateway.onMessage(receiveGateway);
    gateway.onClose(finish);
    gateway.onError(() => {
      emit({ type: "app.error", error: { message: "Voice gateway connection failed" } });
      stop();
    });
    gateway.send(
      JSON.stringify({
        type: "session.start",
        session: {
          model: config.liveModel,
          instructions: personal.instructions,
          audio: { output: { voice: "marin" } },
          delegation: { type: "client" },
        },
        transport: { type: "webrtc", sdp },
      }),
    );
  }

  browser.onMessage((data) => {
    try {
      if (typeof data !== "string" || data.length > 64 * 1024) throw new Error("Invalid client message");
      const event = JSON.parse(data);
      if (event.type === "session.close") return stop();
      if (closing) return;
      if (!gateway) {
        if (starting || event.type !== "app.start" || typeof event.sdp !== "string" || !event.sdp.trim()) {
          throw new Error("Voice startup message required");
        }
        starting = true;
        execution.waitUntil(
          startSession(event.sdp, event.token, event.conversationId).catch((error) => {
            if (!closing)
              emit({
                type: "app.error",
                error: { message: error instanceof Error ? error.message : "Voice startup failed" },
              });
            stop();
          }),
        );
        return;
      }
      if (event.type === "app.ready") {
        browserReady = true;
        requestGreeting();
        return;
      }
      if (event.type !== "gateway.heartbeat") {
        throw new Error("Unsupported client event");
      }
      if (gateway.readyState !== 1) return stop();
      gateway.send(data);
    } catch {
      emit({ type: "app.error", error: { message: "Voice connection could not be started or continued" } });
      stop();
    }
  });
  browser.onClose(stop);
  browser.onError(stop);
}
