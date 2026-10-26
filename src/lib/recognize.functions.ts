import { createServerFn } from "@tanstack/react-start";

export type Recognition = {
  text: string;
  uncertainWords: string[];
  overallUncertain: boolean;
  confidenceNote: string;
  spelling: { original: string; suggestion: string }[];
};

type Input = { dataUrl: string; mimeType: string; fileName: string };

const SYSTEM = `You transcribe handwritten student notes exactly as written.
Return ONLY a JSON object, no prose, with keys:
"text": the full transcription, preserving line breaks; keep the writer's original spelling (do NOT correct it).
"uncertainWords": array of words in "text" you could not read confidently (exact strings as they appear in "text").
"overallUncertain": true if the page was hard to read overall (blurry, messy, partly illegible).
"confidenceNote": one short friendly sentence about how readable the note was.
"spelling": array of {"original","suggestion"} for likely misspellings in "text" (original must appear verbatim in "text").
If the image contains no readable handwriting, return {"error":"no_text"}.`;

export const recognizeNote = createServerFn({ method: "POST" })
  .inputValidator((input: Input) => {
    if (!input?.dataUrl || !input.mimeType) throw new Error("Missing file");
    if (input.dataUrl.length > 14_000_000) throw new Error("File is too large (max ~10 MB).");
    return input;
  })
  .handler(async ({ data }): Promise<{ ok: true; result: Recognition } | { ok: false; error: string }> => {
    const apiKey = process.env.LOVABLE_API_KEY;
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
          { role: "user", content: [{ type: "text", text: "Transcribe this handwritten note as JSON." }, media] },
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
      return {
        ok: true,
        result: {
          text: parsed.text,
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
