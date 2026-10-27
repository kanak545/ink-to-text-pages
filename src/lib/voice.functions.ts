import { createServerFn } from "@tanstack/react-start";

const PROVIDER_OPTS = {
  openai: { forceReasoning: true, reasoningEffort: "low", reasoningSummary: "auto", store: false, include: ["reasoning.encrypted_content"] },
} as const;

async function chat(system: string, user: string): Promise<string | null> {
  const apiKey = process.env["LOVABLE_API_KEY"];
  if (!apiKey) return null;
  const { createOpenAI } = await import("@ai-sdk/openai");
  const { streamText } = await import("ai");
  const provider = createOpenAI({
    baseURL: "https://ai.gateway.lovable.dev/v1",
    apiKey,
    headers: { "Lovable-API-Key": apiKey, "X-Lovable-AIG-SDK": "vercel-ai-sdk" },
  });
  const result = streamText({
    model: provider.responses("openai/gpt-6-astra"),
    system,
    messages: [{ role: "user", content: user }],
    providerOptions: PROVIDER_OPTS,
  });
  return result.text;
}

// Applies a spoken editing instruction ("write X instead of Y", "delete the
// last sentence", "add ...") to the user's text. Never invents content beyond
// what the instruction asks for.
export const applyVoiceEdit = createServerFn({ method: "POST" })
  .inputValidator((input: { text: string; instruction: string }) => {
    if (!input?.instruction?.trim()) throw new Error("No instruction");
    return { text: (input.text ?? "").slice(0, 20000), instruction: input.instruction.slice(0, 2000) };
  })
  .handler(async ({ data }): Promise<{ ok: true; text: string } | { ok: false; error: string }> => {
    try {
      const raw = await chat(
        `You apply spoken editing instructions to a student's notes. Return ONLY a JSON object {"text": "the full updated text"}.
Rules: change only what the instruction asks for; keep everything else exactly as it was, including line breaks; never add facts the instruction didn't mention; if the instruction is unclear or impossible, return {"error":"unclear"}.`,
        `CURRENT TEXT:\n${data.text}\n\nSPOKEN INSTRUCTION: ${data.instruction}`,
      );
      const m = raw?.match(/\{[\s\S]*\}/);
      const parsed = m ? JSON.parse(m[0]) : null;
      if (!parsed || parsed.error || typeof parsed.text !== "string")
        return { ok: false, error: "I couldn't work out that change. Try saying it a different way, like \"write photosynthesis instead of fotosynthesis\"." };
      return { ok: true, text: parsed.text };
    } catch (e: any) {
      const status = e?.statusCode ?? e?.status;
      if (status === 429) return { ok: false, error: "The voice editor is busy. Please wait a moment and try again." };
      if (status === 402) return { ok: false, error: "The voice editor has run out of credits for now. Please try again later." };
      console.error("voice edit failed", e);
      return { ok: false, error: "Something went wrong with that voice edit. Please try again." };
    }
  });

// Matches a spoken quiz answer to one of the options. Returns the option
// index, or -1 when nothing matches.
export const matchQuizAnswer = createServerFn({ method: "POST" })
  .inputValidator((input: { question: string; options: string[]; spoken: string }) => {
    if (!input?.spoken?.trim() || !Array.isArray(input.options) || input.options.length < 2) throw new Error("Bad input");
    return { question: String(input.question).slice(0, 1000), options: input.options.map((o) => String(o).slice(0, 300)), spoken: input.spoken.slice(0, 1000) };
  })
  .handler(async ({ data }): Promise<{ ok: true; index: number } | { ok: false; error: string }> => {
    try {
      const raw = await chat(
        `You match a student's spoken quiz answer to one of the multiple-choice options. The student may say the option letter, its number, or its meaning in their own words. Return ONLY JSON {"index": 0} using the zero-based option index, or {"index": -1} if the spoken answer clearly matches none of the options.`,
        `QUESTION: ${data.question}\nOPTIONS:\n${data.options.map((o, i) => `${i}: ${o}`).join("\n")}\n\nSPOKEN ANSWER: ${data.spoken}`,
      );
      const m = raw?.match(/\{[\s\S]*\}/);
      const parsed = m ? JSON.parse(m[0]) : null;
      const index = Number(parsed?.index);
      if (!Number.isInteger(index)) return { ok: false, error: "I couldn't match that to an option. Try again or tap your answer." };
      if (index < 0 || index >= data.options.length)
        return { ok: false, error: "That didn't match any of the options. Try again or tap your answer." };
      return { ok: true, index };
    } catch (e: any) {
      const status = e?.statusCode ?? e?.status;
      if (status === 429) return { ok: false, error: "The voice helper is busy. Please wait a moment and try again." };
      if (status === 402) return { ok: false, error: "The voice helper has run out of credits for now. Please try again later." };
      console.error("quiz voice match failed", e);
      return { ok: false, error: "Something went wrong. Please try again or tap your answer." };
    }
  });
