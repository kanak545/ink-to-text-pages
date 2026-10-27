import { createFileRoute } from "@tanstack/react-router";

// Turns a short voice recording into text. The browser uploads a WAV file;
// we forward it to the transcription model and return the transcript.
// This endpoint never stores audio and returns only the caller's own words.

const MAX_BYTES = 20 * 1024 * 1024; // stay under the 25 MiB endpoint cap

export const Route = createFileRoute("/api/public/transcribe")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apiKey = process.env["LOVABLE_API_KEY"];
        if (!apiKey) return Response.json({ error: "Voice typing isn't set up yet. Please try again later." }, { status: 503 });

        const declared = Number(request.headers.get("content-length") ?? 0);
        if (declared > MAX_BYTES) return Response.json({ error: "That recording is too long. Keep it under a minute." }, { status: 413 });

        let form: FormData;
        try {
          form = await request.formData();
        } catch {
          return Response.json({ error: "We couldn't read that recording. Please try again." }, { status: 400 });
        }
        const file = form.get("file");
        if (!(file instanceof File) || !file.size || file.size > MAX_BYTES || !file.type.startsWith("audio/"))
          return Response.json({ error: "We couldn't read that recording. Please try again." }, { status: 400 });

        const upstream = new FormData();
        upstream.append("model", "openai/gpt-transcribe");
        upstream.append("file", file, file.name || "recording.wav");
        upstream.append("response_format", "json");

        let res: Response;
        try {
          res = await fetch("https://ai.gateway.lovable.dev/v1/audio/transcriptions", {
            method: "POST",
            headers: { Authorization: `Bearer ${apiKey}` },
            body: upstream,
          });
        } catch {
          return Response.json({ error: "We couldn't reach the voice service. Check your connection and try again." }, { status: 502 });
        }

        if (!res.ok) {
          const status = res.status;
          if (status === 429) return Response.json({ error: "Lots of people are using voice typing right now. Please wait a moment and try again." }, { status: 429 });
          if (status === 402) return Response.json({ error: "Voice typing has run out of credits for now. Please try again later." }, { status: 402 });
          return Response.json({ error: "We couldn't understand that recording. Please try again, speaking clearly." }, { status: 400 });
        }

        const data = (await res.json().catch(() => null)) as { text?: string } | null;
        const text = typeof data?.text === "string" ? data.text.trim() : "";
        if (!text) return Response.json({ error: "We didn't catch any words. Try again, a little louder and slower." }, { status: 422 });
        return Response.json({ text });
      },
    },
  },
});
