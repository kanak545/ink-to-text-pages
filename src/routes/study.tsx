import { createFileRoute, Link } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getNoteText } from "@/lib/upload-store";
import { summarizeNote, quizNote, type StudyPack, type QuizQuestion } from "@/lib/recognize.functions";
import { matchQuizAnswer } from "@/lib/voice.functions";
import { startRecording, type Recorder } from "@/lib/record-wav";

export const Route = createFileRoute("/study")({
  head: () => ({
    meta: [
      { title: "Study mode — Ink to Text" },
      { name: "description", content: "Turn your notes into a summary, key points and a quiz you can answer by voice." },
      { property: "og:title", content: "Study mode — Ink to Text" },
      { property: "og:description", content: "Summaries, key points and voice-answered quizzes made only from your notes." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Study,
});

async function transcribe(file: File): Promise<string> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch("/api/public/transcribe", { method: "POST", body: form });
  const data = (await res.json().catch(() => null)) as { text?: string; error?: string } | null;
  if (!res.ok || !data?.text) throw new Error(data?.error ?? "We couldn't understand that recording. Please try again.");
  return data.text;
}

function Study() {
  const text = getNoteText();
  const summarize = useServerFn(summarizeNote);
  const makeQuiz = useServerFn(quizNote);
  const matchAnswer = useServerFn(matchQuizAnswer);

  const [study, setStudy] = useState<{ state: "idle" | "loading" | "error" | "done"; error?: string; pack?: StudyPack }>({ state: "idle" });
  const [quiz, setQuiz] = useState<{ state: "idle" | "loading" | "error" | "done"; error?: string; qs?: QuizQuestion[]; picks: (number | null)[]; checked: boolean }>({ state: "idle", picks: [], checked: false });
  const [voice, setVoice] = useState<{ q: number | null; phase: "idle" | "recording" | "working"; heard?: string; error?: string }>({ q: null, phase: "idle" });
  const recorder = useRef<Recorder | null>(null);

  const makeSummary = async () => {
    setStudy({ state: "loading" });
    try {
      const r = await summarize({ data: { text } });
      setStudy(r.ok ? { state: "done", pack: r.result } : { state: "error", error: r.error });
    } catch {
      setStudy({ state: "error", error: "We couldn't reach the study helper. Check your connection and try again." });
    }
  };

  const startQuiz = async () => {
    setQuiz({ state: "loading", picks: [], checked: false });
    try {
      const r = await makeQuiz({ data: { text } });
      setQuiz(r.ok ? { state: "done", qs: r.result, picks: r.result.map(() => null), checked: false } : { state: "error", error: r.error, picks: [], checked: false });
    } catch {
      setQuiz({ state: "error", error: "We couldn't reach the quiz helper. Check your connection and try again.", picks: [], checked: false });
    }
  };

  const toggleVoice = async (qi: number) => {
    if (voice.phase === "recording" && voice.q === qi) {
      setVoice({ q: qi, phase: "working" });
      try {
        const file = await recorder.current!.stop();
        recorder.current = null;
        const spoken = await transcribe(file);
        const q = quiz.qs![qi]!;
        const r = await matchAnswer({ data: { question: q.question, options: q.options, spoken } });
        if (!r.ok) {
          setVoice({ q: qi, phase: "idle", heard: spoken, error: r.error });
          return;
        }
        setQuiz((z) => ({ ...z, picks: z.picks.map((p, j) => (j === qi ? r.index : p)) }));
        setVoice({ q: qi, phase: "idle", heard: spoken });
      } catch (e: any) {
        recorder.current = null;
        setVoice({ q: qi, phase: "idle", error: e?.message ?? "That didn't work. Please try again." });
      }
      return;
    }
    if (voice.phase !== "idle") return;
    try {
      recorder.current = await startRecording();
      setVoice({ q: qi, phase: "recording", heard: undefined, error: undefined });
    } catch {
      setVoice({ q: qi, phase: "idle", error: "We couldn't use your microphone. Check the browser permission and try again." });
    }
  };

  if (!text.trim())
    return (
      <Shell>
        <div className="mx-auto max-w-md rounded-3xl bg-card p-8 text-center shadow-soft">
          <p className="text-lg text-deep">No note to study yet.</p>
          <p className="mt-2 text-sm text-muted-foreground">Upload a note first — study mode works from your recognized text.</p>
          <Link to="/" className="mt-5 inline-block rounded-2xl bg-primary px-6 py-3 font-semibold text-primary-foreground">Upload a handwritten note</Link>
        </div>
      </Shell>
    );

  return (
    <Shell>
      <div className="mx-auto max-w-3xl space-y-8">
        <section className="rounded-3xl bg-card p-6 shadow-soft sm:p-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-2xl text-deep">Summary</h2>
              <p className="text-sm text-muted-foreground">A short summary and key points made only from your notes.</p>
            </div>
            <button onClick={makeSummary} disabled={study.state === "loading"}
              className="rounded-2xl bg-primary px-5 py-2.5 font-semibold text-primary-foreground shadow-soft hover:bg-deep disabled:opacity-50">
              {study.state === "done" ? "Regenerate summary" : study.state === "loading" ? "Summarizing…" : "Generate summary"}
            </button>
          </div>
          {study.state === "loading" && <div className="mt-8 flex justify-center"><div className="h-8 w-8 animate-spin rounded-full border-4 border-soft border-t-primary" /></div>}
          {study.state === "error" && <p role="alert" className="mt-5 rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">{study.error}</p>}
          {study.state === "done" && study.pack && (
            <div className="mt-5 space-y-5">
              <section className="rounded-2xl bg-page p-5">
                <h3 className="mb-2 font-display text-deep">Summary</h3>
                <p className="font-serif text-lg leading-8">{study.pack.summary}</p>
              </section>
              {study.pack.keyPoints.length > 0 && (
                <section className="rounded-2xl bg-page p-5">
                  <h3 className="mb-2 font-display text-deep">Key points</h3>
                  <ul className="list-disc space-y-1.5 pl-5">{study.pack.keyPoints.map((k, i) => <li key={i}>{k}</li>)}</ul>
                </section>
              )}
            </div>
          )}
        </section>

        <section className="rounded-3xl bg-card p-6 shadow-soft sm:p-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-2xl text-deep">Quiz</h2>
              <p className="text-sm text-muted-foreground">Multiple-choice questions from your notes. Tap an answer, or use the mic to say it.</p>
            </div>
            <button onClick={startQuiz} disabled={quiz.state === "loading"}
              className="rounded-2xl bg-primary px-5 py-2.5 font-semibold text-primary-foreground shadow-soft hover:bg-deep disabled:opacity-50">
              {quiz.state === "loading" ? "Making quiz…" : quiz.state === "done" ? "New quiz" : "Make a quiz"}
            </button>
          </div>
          {quiz.state === "loading" && <div className="mt-6 flex justify-center"><div className="h-8 w-8 animate-spin rounded-full border-4 border-soft border-t-primary" /></div>}
          {quiz.state === "error" && <p role="alert" className="mt-5 rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">{quiz.error}</p>}
          {quiz.state === "done" && quiz.qs && (
            <div className="mt-5 space-y-4">
              {quiz.qs.map((q, qi) => {
                const recording = voice.phase === "recording" && voice.q === qi;
                const working = voice.phase === "working" && voice.q === qi;
                return (
                  <fieldset key={qi} className="rounded-2xl bg-page p-5">
                    <legend className="sr-only">Question {qi + 1}</legend>
                    <div className="mb-3 flex items-start justify-between gap-3">
                      <p className="font-medium text-deep">{qi + 1}. {q.question}</p>
                      {!quiz.checked && (
                        <button onClick={() => toggleVoice(qi)} disabled={voice.phase !== "idle" && !recording}
                          aria-label={recording ? "Stop and use this answer" : `Answer question ${qi + 1} by voice`}
                          className={`flex shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition disabled:opacity-50 ${recording ? "bg-destructive text-destructive-foreground" : "bg-card text-deep shadow-soft hover:bg-soft"}`}>
                          <MicIcon active={recording} />
                          {recording ? "Stop" : working ? "Listening…" : "Answer by voice"}
                        </button>
                      )}
                    </div>
                    {voice.q === qi && voice.heard && <p className="mb-3 text-sm text-muted-foreground">You said: “{voice.heard}”</p>}
                    {voice.q === qi && voice.error && <p role="alert" className="mb-3 rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">{voice.error}</p>}
                    <div className="grid gap-2">
                      {q.options.map((o, oi) => {
                        const picked = quiz.picks[qi] === oi;
                        const right = quiz.checked && oi === q.answerIndex;
                        const wrong = quiz.checked && picked && oi !== q.answerIndex;
                        return (
                          <label key={oi} className={`flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-2.5 text-sm transition ${right ? "border-success bg-success/10" : wrong ? "border-destructive bg-destructive/10" : picked ? "border-primary bg-soft" : "border-border bg-card hover:bg-soft"}`}>
                            <input type="radio" name={`q${qi}`} checked={picked} disabled={quiz.checked}
                              onChange={() => setQuiz((z) => ({ ...z, picks: z.picks.map((p, j) => (j === qi ? oi : p)) }))} className="accent-primary" />
                            <span>{o}</span>
                            {right && <span className="ml-auto font-medium text-success">Correct answer</span>}
                            {wrong && <span className="ml-auto font-medium text-destructive">Your answer</span>}
                          </label>
                        );
                      })}
                    </div>
                    {quiz.checked && q.explanation && <p className="mt-3 text-sm text-muted-foreground">{q.explanation}</p>}
                  </fieldset>
                );
              })}
              {quiz.checked ? (
                <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-soft p-5">
                  <p className="font-display text-xl text-deep">
                    Score: {quiz.picks.filter((p, i) => p === quiz.qs![i]!.answerIndex).length} / {quiz.qs.length}
                  </p>
                  <button onClick={() => setQuiz((z) => ({ ...z, picks: z.picks.map(() => null), checked: false }))} className="ml-auto rounded-xl bg-card px-4 py-2 font-medium text-deep">Try again</button>
                </div>
              ) : (
                <button onClick={() => setQuiz((z) => ({ ...z, checked: true }))} disabled={quiz.picks.some((p) => p === null)}
                  className="rounded-2xl bg-primary px-5 py-3 font-semibold text-primary-foreground shadow-soft disabled:opacity-50">
                  {quiz.picks.some((p) => p === null) ? "Answer every question to check" : "Check answers"}
                </button>
              )}
            </div>
          )}
        </section>
      </div>
    </Shell>
  );
}

function MicIcon({ active }: { active: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className={active ? "animate-pulse" : undefined}>
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 10a7 7 0 0 0 14 0" />
      <line x1="12" y1="17" x2="12" y2="22" />
    </svg>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen px-4 py-6 sm:px-8">
      <header className="mx-auto mb-6 flex max-w-6xl items-center justify-between">
        <Link to="/" className="font-display text-xl font-semibold text-deep">Ink to Text</Link>
        <div className="flex gap-4 text-sm font-medium">
          <Link to="/editor" className="text-primary">Back to editor</Link>
          <Link to="/" className="text-primary">New upload</Link>
        </div>
      </header>
      {children}
    </main>
  );
}
