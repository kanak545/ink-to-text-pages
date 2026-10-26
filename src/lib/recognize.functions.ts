import { createServerFn } from "@tanstack/react-start";

export type Recognition = {
  text: string;
  uncertainWords: string[];
  overallUncertain: boolean;
  confidenceNote: string;
  spelling: { original: string; suggestion: string }[];
  crossedOut: { marker: string; guess: string | null }[];
};

type Input = { dataUrl: string; mimeType: string; fileName: string };

const SYSTEM = `You transcribe handwritten student notes exactly as written.
Return ONLY a JSON object, no prose, with keys:
"text": the full transcription, preserving line breaks; keep the writer's original spelling (do NOT correct it).
"uncertainWords": array of words in "text" you could not read confidently (exact strings as they appear in "text").
"overallUncertain": true if the page was hard to read overall (blurry, messy, partly illegible).
"confidenceNote": one short friendly sentence about how readable the note was.
"spelling": array of {"original","suggestion"} for likely misspellings in "text" (original must appear verbatim in "text").
"crossedOut": for every crossed-out/struck-through word or phrase, in reading order, put the literal marker [crossed out] in "text" at its position, and add an entry {"guess": best guess of what was written underneath, or null if unreadable} to this array (same order as the markers).
If the image contains no readable handwriting, return {"error":"no_text"}.`;

export const recognizeNote = createServerFn({ method: "POST" })
  .inputValidator((input: Input) => {
    if (!input?.dataUrl || !input.mimeType) throw new Error("Missing file");
    if (input.dataUrl.length > 14_000_000) throw new Error("File is too large (max ~10 MB).");
    return input;
  })
  .handler(async ({ data }): Promise<{ ok: true; result: Recognition } | { ok: false; error: string }> => {
    const apiKey = process.env['LOVABLE_API_KEY'];
    if (!apiKey) return { ok: false, error: "The reading service isn't set up yet. Please try again later." };
    const { createOpenAI } = await import("@ai-sdk/openai");
    const { streamText } = await import("ai");
    const provider = createOpenAI({
      baseURL: "https://ai.gateway.lovable.dev/v1",
      apiKey,
      headers: { "Lovable-API-Key": apiKey, "X-Lovable-AIG-SDK": "vercel-ai-sdk" },
    });
    const media =
      data.mimeType === "application/pdf"
        ? ({ type: "file", filename: data.fileName || "note.pdf", data: data.dataUrl.split(",")[1] ?? "", mediaType: "application/pdf" } as const)
        : ({ type: "image", image: new URL(data.dataUrl) } as const);
    try {
      const result = streamText({
        model: provider.responses("openai/gpt-6-astra"),
        system: SYSTEM,
        messages: [
          { role: "user", content: [{ type: "text", text: "Transcribe this handwritten note as JSON." }, media as never] },
        ],
        providerOptions: {
          openai: {
            forceReasoning: true,
            reasoningEffort: "low",
            reasoningSummary: "auto",
            store: false,
            include: ["reasoning.encrypted_content"],
          },
        },
      });
      const raw = await result.text;
      const match = raw.match(/\{[\s\S]*\}/);
      if (!match) return { ok: false, error: "We couldn't read this note. Try a clearer, well-lit photo." };
      const parsed = JSON.parse(match[0]);
      if (parsed.error || typeof parsed.text !== "string" || !parsed.text.trim())
        return { ok: false, error: "We couldn't find readable handwriting in this file. Try a sharper photo with the page filling the frame." };
      const guesses: unknown[] = Array.isArray(parsed.crossedOut) ? parsed.crossedOut : [];
      const crossedOut: Recognition["crossedOut"] = [];
      let n = 0;
      const text = (parsed.text as string).replace(/\[crossed out\]/gi, () => {
        const g = guesses[n] as { guess?: unknown } | undefined;
        n += 1;
        const marker = `[crossed out ${n}]`;
        const guess = typeof g?.guess === "string" && g.guess.trim() ? g.guess.trim() : null;
        crossedOut.push({ marker, guess });
        return marker;
      });
      return {
        ok: true,
        result: {
          text,
          crossedOut,
          uncertainWords: Array.isArray(parsed.uncertainWords) ? parsed.uncertainWords.filter((w: unknown) => typeof w === "string" && w) : [],
          overallUncertain: !!parsed.overallUncertain,
          confidenceNote: String(parsed.confidenceNote ?? ""),
          spelling: Array.isArray(parsed.spelling)
            ? parsed.spelling.filter((s: any) => s?.original && s?.suggestion && s.original !== s.suggestion)
            : [],
        },
      };
    } catch (e: any) {
      const status = e?.statusCode ?? e?.status;
      if (status === 429) return { ok: false, error: "Lots of notes are being read right now. Please wait a moment and try again." };
      if (status === 402) return { ok: false, error: "The reading service has run out of credits for now. Please try again later." };
      console.error("recognition failed", e);
      return { ok: false, error: "Something went wrong while reading your note. Please try again." };
    }
  });

export type StudyPack = { summary: string; keyPoints: string[] };

export const summarizeNote = createServerFn({ method: "POST" })
  .inputValidator((input: { text: string }) => {
    if (!input?.text?.trim()) throw new Error("No text to summarize");
    return { text: input.text.slice(0, 20000) };
  })
  .handler(async ({ data }): Promise<{ ok: true; result: StudyPack } | { ok: false; error: string }> => {
    const apiKey = process.env['LOVABLE_API_KEY'];
    if (!apiKey) return { ok: false, error: "The study helper isn't set up yet. Please try again later." };
    const { createOpenAI } = await import("@ai-sdk/openai");
    const { streamText } = await import("ai");
    const provider = createOpenAI({
      baseURL: "https://ai.gateway.lovable.dev/v1",
      apiKey,
      headers: { "Lovable-API-Key": apiKey, "X-Lovable-AIG-SDK": "vercel-ai-sdk" },
    });
    try {
      const result = streamText({
        model: provider.responses("openai/gpt-6-astra"),
        system: `You help students study their own notes. Use only facts in the notes; do not add outside information. Ignore markers like [crossed out 1] or [illegible]. Write in simple, friendly English.
Return ONLY JSON: {"summary": "3-5 sentence summary", "keyPoints": ["short key point", ...]} (3-7 key points). If the notes are too short or unclear to summarize, return {"error":"too_short"}.`,
        messages: [{ role: "user", content: data.text }],
        providerOptions: {
          openai: { forceReasoning: true, reasoningEffort: "low", reasoningSummary: "auto", store: false, include: ["reasoning.encrypted_content"] },
        },
      });
      const raw = await result.text;
      const m = raw.match(/\{[\s\S]*\}/);
      const parsed = m ? JSON.parse(m[0]) : null;
      if (!parsed || parsed.error || typeof parsed.summary !== "string")
        return { ok: false, error: "These notes are too short or unclear to summarize. Add a bit more text and try again." };
      return {
        ok: true,
        result: { summary: parsed.summary, keyPoints: Array.isArray(parsed.keyPoints) ? parsed.keyPoints.filter((k: unknown) => typeof k === "string") : [] },
      };
    } catch (e: any) {
      const status = e?.statusCode ?? e?.status;
      if (status === 429) return { ok: false, error: "The study helper is busy. Please wait a moment and try again." };
      if (status === 402) return { ok: false, error: "The study helper has run out of credits for now. Please try again later." };
      console.error("summary failed", e);
      return { ok: false, error: "Something went wrong while making your summary. Please try again." };
    }
  });

export type QuizQuestion = { question: string; options: string[]; answerIndex: number; explanation: string };

export const quizNote = createServerFn({ method: "POST" })
  .inputValidator((input: { text: string }) => {
    if (!input?.text?.trim()) throw new Error("No text for a quiz");
    return { text: input.text.slice(0, 20000) };
  })
  .handler(async ({ data }): Promise<{ ok: true; result: QuizQuestion[] } | { ok: false; error: string }> => {
    const apiKey = process.env['LOVABLE_API_KEY'];
    if (!apiKey) return { ok: false, error: "The quiz helper isn't set up yet. Please try again later." };
    const { createOpenAI } = await import("@ai-sdk/openai");
    const { streamText } = await import("ai");
    const provider = createOpenAI({
      baseURL: "https://ai.gateway.lovable.dev/v1",
      apiKey,
      headers: { "Lovable-API-Key": apiKey, "X-Lovable-AIG-SDK": "vercel-ai-sdk" },
    });
    try {
      const result = streamText({
        model: provider.responses("openai/gpt-6-astra"),
        system: `You write study quizzes from a student's own notes. Every question and correct answer must come only from facts in the notes. Ignore markers like [crossed out 1] or [illegible]. Simple, friendly English.
Return ONLY JSON: {"questions":[{"question":"...","options":["a","b","c","d"],"answerIndex":0,"explanation":"one short sentence citing the notes"}]} with 3-6 questions, exactly 4 options each, varied answer positions. If the notes have too little content, return {"error":"too_short"}.`,
        messages: [{ role: "user", content: data.text }],
        providerOptions: {
          openai: { forceReasoning: true, reasoningEffort: "low", reasoningSummary: "auto", store: false, include: ["reasoning.encrypted_content"] },
        },
      });
      const raw = await result.text;
      const m = raw.match(/\{[\s\S]*\}/);
      const parsed = m ? JSON.parse(m[0]) : null;
      const qs: QuizQuestion[] = Array.isArray(parsed?.questions)
        ? parsed.questions.filter(
            (q: any) => typeof q?.question === "string" && Array.isArray(q.options) && q.options.length >= 2 &&
              Number.isInteger(q.answerIndex) && q.answerIndex >= 0 && q.answerIndex < q.options.length,
          ).map((q: any) => ({ question: q.question, options: q.options.map(String), answerIndex: q.answerIndex, explanation: String(q.explanation ?? "") }))
        : [];
      if (!qs.length) return { ok: false, error: "These notes are too short to make a quiz. Add a bit more text and try again." };
      return { ok: true, result: qs };
    } catch (e: any) {
      const status = e?.statusCode ?? e?.status;
      if (status === 429) return { ok: false, error: "The quiz helper is busy. Please wait a moment and try again." };
      if (status === 402) return { ok: false, error: "The quiz helper has run out of credits for now. Please try again later." };
      console.error("quiz failed", e);
      return { ok: false, error: "Something went wrong while making your quiz. Please try again." };
    }
  });
