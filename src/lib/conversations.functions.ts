import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

type Entry = { role: "user" | "assistant"; text: string };

const reflectionSchema = z.object({
  title: z.string(),
  summary: z.string(),
  new_memories: z.array(
    z.object({
      content: z.string(),
      category: z.enum(["fakt", "preferencia", "záujem", "cieľ", "štýl"]),
    }),
  ),
});

/** Odošle textovú správu Brumíkovi a uloží odpoveď do histórie. */
export const sendTextMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { conversationId: string; message: string }) => ({
    conversationId: input.conversationId,
    message: input.message.trim(),
  }))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // 1. Zistíme pozíciu a zapíšeme správu používateľa
    const { count } = await supabase
      .from("transcript_entries")
      .select("id", { count: "exact", head: true })
      .eq("conversation_id", data.conversationId);

    const position = count ?? 0;
    await supabase.from("transcript_entries").insert({
      conversation_id: data.conversationId,
      user_id: userId,
      role: "user",
      text: data.message,
      position,
    });

    // 2. Načítame spomienky pre zachovanie kontextu a osobnosti
    const { data: memories } = await supabase
      .from("memories")
      .select("content")
      .order("created_at", { ascending: false })
      .limit(60);

    const openaiKey = process.env["OPENAI_API_KEY"] || process.env["LOVABLE_API_KEY"];
    if (!openaiKey) throw new Error("AI nie je nakonfigurovaná");

    const { createOpenAI } = await import("@ai-sdk/openai");
    const { generateText } = await import("ai");

    const isCustomOpenAI = Boolean(process.env["OPENAI_API_KEY"]);

    const provider = createOpenAI({
      baseURL: isCustomOpenAI ? "https://api.openai.com/v1" : "https://ai.gateway.lovable.dev/v1",
      apiKey: openaiKey,
      headers: isCustomOpenAI ? {} : { "Lovable-API-Key": openaiKey, "X-Lovable-AIG-SDK": "vercel-ai-sdk" },
    });

    // 3. Odpoveď Brumíka
        const { text: reply } = await generateText({
      model: provider(isCustomOpenAI ? "gpt-4o" : "openai/gpt-5"),
      system: `Si Brumík, osobný inteligentný spoločník. Hovoríš po slovensky, máš všestranný rozhľad a bohaté znalosti z technológií, vedy aj zo sveta.
Na otázky používateľa odpovedaj priamo, múdro a zaujímavo. Nikdy neodpovedaj vyhýbavo, že ti niečo nevysvetlil — využi svoje všeobecné vedomosti.
Poznatky o používateľovi:\n${(memories ?? []).map((m) => `- ${m.content}`).join("\n") || "- zatiaľ žiadne"}`,
      prompt: data.message,
    });

    // 4. Zapíšeme odpoveď Brumíka do histórie
    await supabase.from("transcript_entries").insert({
      conversation_id: data.conversationId,
      user_id: userId,
      role: "assistant",
      text: reply,
      position: position + 1,
    });

    return { reply };
  });

/** Uloží hovor, vyextrahuje nové spomienky a vytvorí zhrnutie. */
export const finishConversation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { conversationId: string; entries: Entry[] }) => {
    if (!/^[0-9a-f-]{36}$/i.test(input.conversationId)) throw new Error("Neplatný rozhovor");
    const entries = (input.entries ?? [])
      .filter((e) => (e.role === "user" || e.role === "assistant") && typeof e.text === "string" && e.text.trim())
      .slice(0, 400)
      .map((e) => ({ role: e.role, text: e.text.trim().slice(0, 4000) }));
    return { conversationId: input.conversationId, entries };
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: conversation } = await supabase
      .from("conversations")
      .select("id, summary")
      .eq("id", data.conversationId)
      .maybeSingle();
    if (!conversation) throw new Error("Rozhovor sa nenašiel");
    if (!data.entries.length) return { learned: 0 };

    const { count } = await supabase
      .from("transcript_entries")
      .select("id", { count: "exact", head: true })
      .eq("conversation_id", data.conversationId);
    const offset = count ?? 0;
    const { error: insertError } = await supabase.from("transcript_entries").insert(
      data.entries.map((e, i) => ({
        conversation_id: data.conversationId,
        user_id: userId,
        role: e.role,
        text: e.text,
        position: offset + i,
      })),
    );
    if (insertError) throw new Error("Prepis sa nepodarilo uložiť");

    const { data: memories } = await supabase
      .from("memories")
      .select("content")
      .order("created_at", { ascending: false })
      .limit(120);

    const openaiKey = process.env["OPENAI_API_KEY"] || process.env["LOVABLE_API_KEY"];
    if (!openaiKey) throw new Error("AI nie je nakonfigurovaná");

    const { createOpenAI } = await import("@ai-sdk/openai");
    const { streamText, Output, NoObjectGeneratedError } = await import("ai");

    const isCustomOpenAI = Boolean(process.env["OPENAI_API_KEY"]);

    const provider = createOpenAI({
      baseURL: isCustomOpenAI ? "https://api.openai.com/v1" : "https://ai.gateway.lovable.dev/v1",
      apiKey: openaiKey,
      headers: isCustomOpenAI ? {} : { "Lovable-API-Key": openaiKey, "X-Lovable-AIG-SDK": "vercel-ai-sdk" },
    });

    const transcript = data.entries
      .map((e) => `${e.role === "user" ? "Používateľ" : "Asistent"}: ${e.text}`)
      .join("\n");

    const result = streamText({
      model: isCustomOpenAI ? provider("gpt-4o") : provider.responses("openai/gpt-6-astra"),
      maxRetries: 0,
      output: Output.object({ schema: reflectionSchema }),
      ...(isCustomOpenAI
        ? {}
        : {
            providerOptions: {
              openai: {
                forceReasoning: true,
                reasoningEffort: "low",
                reasoningSummary: "auto",
                store: false,
                include: ["reasoning.encrypted_content"],
              },
            },
          }),
      system:
        "Analyzuješ hlasový rozhovor osobného AI spoločníka s jeho jediným používateľom. Všetko píš po slovensky. " +
        "title: krátky názov rozhovoru (max 6 slov). summary: 1–3 vety o tom, čo sa riešilo (ak existuje predchádzajúci súhrn, zahrň ho). " +
        "new_memories: iba NOVÉ trvalé poznatky o používateľovi (fakty o živote, preferencie, záujmy, ciele, preferovaný štýl odpovedí), " +
        "ktoré ešte nie sú v zozname známych poznatkov. Krátke vety v tretej osobe. Maximálne 8. Ak nič nové, prázdne pole.",
      prompt:
        `Známe poznatky:\n${(memories ?? []).map((m) => `- ${m.content}`).join("\n") || "- žiadne"}\n\n` +
        `Predchádzajúci súhrn: ${conversation.summary ?? "žiadny"}\n\nPrepis:\n${transcript}`,
    });

    let reflection: z.infer<typeof reflectionSchema> | null = null;
    try {
      reflection = await result.output;
    } catch (error) {
      if (NoObjectGeneratedError.isInstance(error) && error.text) {
        const parsed = reflectionSchema.safeParse(JSON.parse(error.text));
        if (parsed.success) reflection = parsed.data;
      }
      if (!reflection) {
        console.error("Reflection failed", error);
        await supabase
          .from("conversations")
          .update({ updated_at: new Date().toISOString() })
          .eq("id", data.conversationId);
        return { learned: 0 };
      }
    }

    const fresh = reflection.new_memories
      .map((m) => ({ content: m.content.trim().slice(0, 300), category: m.category }))
      .filter((m) => m.content)
      .slice(0, 8);

    if (fresh.length) {
      await supabase.from("memories").insert(
        fresh.map((m) => ({ ...m, user_id: userId, source_conversation_id: data.conversationId })),
      );
    }

    await supabase
      .from("conversations")
      .update({
        title: reflection.title.trim().slice(0, 80) || "Rozhovor",
        summary: reflection.summary.trim().slice(0, 1000),
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.conversationId);

    return { learned: fresh.length };
  });
