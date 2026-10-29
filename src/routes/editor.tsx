import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getUpload, setNoteText, type Upload } from "@/lib/upload-store";
import { recognizeNote, type Recognition } from "@/lib/recognize.functions";
import { applyVoiceEdit } from "@/lib/voice.functions";
import { startRecording, type Recorder } from "@/lib/record-wav";

export const Route = createFileRoute("/editor")({
  head: () => ({
    meta: [
      { title: "Editor — Ink to Text" },
      { name: "description", content: "Review and edit the text recognized from your handwritten note." },
      { property: "og:title", content: "Editor — Ink to Text" },
      { property: "og:description", content: "Review flagged words, accept spelling fixes, and download your notes." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Editor,
});

type PageStyle = "classic" | "modern" | "academic";
const PDF_STYLES: Record<PageStyle, { font: "times" | "helvetica"; size: number; lineHeight: number; margin: number; title: boolean; titleColor?: [number, number, number]; pageNumbers: boolean }> = {
  classic: { font: "times", size: 12, lineHeight: 1.5, margin: 72, title: false, pageNumbers: false },
  modern: { font: "helvetica", size: 11, lineHeight: 1.6, margin: 60, title: true, titleColor: [37, 99, 235], pageNumbers: false },
  academic: { font: "times", size: 12, lineHeight: 2, margin: 72, title: true, pageNumbers: true },
};
type Cross = { marker: string; guess: string | null; status: "pending" | "kept" | "removed" };
type Sugg = { original: string; suggestion: string; status: "pending" | "accepted" | "rejected" };
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function Editor() {
  const recognize = useServerFn(recognizeNote);
  const voiceEdit = useServerFn(applyVoiceEdit);
  const nav = useNavigate();
  const [upload, setUp] = useState<Upload | null>(null);
  const [state, setState] = useState<"loading" | "error" | "done" | "none">("loading");
  const [error, setError] = useState("");
  const [rec, setRec] = useState<Recognition | null>(null);
  const [text, setText] = useState("");
  const [suggs, setSuggs] = useState<Sugg[]>([]);
  const [crosses, setCrosses] = useState<Cross[]>([]);
  const [tab, setTab] = useState<"edit" | "preview">("edit");
  const [style, setStyle] = useState<PageStyle>("classic");
  const [voice, setVoice] = useState<{ phase: "idle" | "recording" | "working"; heard?: string; error?: string }>({ phase: "idle" });
  const recorder = useRef<Recorder | null>(null);
  const started = useRef(false);

  const run = async (u: Upload) => {
    setState("loading"); setError("");
    try {
      const r = await recognize({ data: u });
      if (!r.ok) { setError(r.error); setState("error"); return; }
      setRec(r.result); setText(r.result.text);
      setCrosses(r.result.crossedOut.map((c) => ({ ...c, status: "pending" })));
      setSuggs(r.result.spelling.map((s) => ({ ...s, status: "pending" })));
      setState("done");
    } catch {
      setError("We couldn't reach the reading service. Check your connection and try again.");
      setState("error");
    }
  };

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const u = getUpload();
    if (!u) { setState("none"); return; }
    setUp(u); run(u);
  }, []);

  const toggleVoice = async () => {
    if (voice.phase === "recording") {
      setVoice({ phase: "working" });
      try {
        const activeRecorder = recorder.current;
        if (!activeRecorder) throw new Error("No recording is available. Please record again.");
        const file = await activeRecorder.stop();
        recorder.current = null;
        const form = new FormData();
        form.append("file", file);
        const res = await fetch("/api/public/transcribe", { method: "POST", body: form });
        const data = (await res.json().catch(() => null)) as { text?: string; error?: string } | null;
        if (!res.ok || !data?.text) {
          setVoice({ phase: "idle", error: data?.error ?? "We couldn't understand that recording. Please try again." });
          return;
        }
        const r = await voiceEdit({ data: { text, instruction: data.text } });
        if (!r.ok) {
          setVoice({ phase: "idle", heard: data.text, error: r.error });
          return;
        }
        setText(r.text);
        setVoice({ phase: "idle", heard: data.text });
      } catch (e: any) {
        recorder.current = null;
        setVoice({ phase: "idle", error: e?.message ?? "That didn't work. Please try again." });
      }
      return;
    }
    if (voice.phase !== "idle") return;
    try {
      recorder.current = await startRecording();
      setVoice({ phase: "recording" });
    } catch {
      setVoice({ phase: "idle", error: "We couldn't use your microphone. Check the browser permission and try again." });
    }
  };

  const stillUncertain = useMemo(
    () => [
      ...crosses.filter((c) => c.status === "pending").map((c) => c.marker),
      ...(rec?.uncertainWords ?? []),
    ].filter((w, i, a) => text.includes(w) && a.indexOf(w) === i),
    [rec, text, crosses],
  );

  const decide = (i: number, accept: boolean) => {
    const s = suggs[i]; if (!s) return;
    if (accept) setText((t) => t.replace(new RegExp(`\\b${esc(s.original)}\\b`), s.suggestion));
    setSuggs((all) => all.map((x, j) => (j === i ? { ...x, status: accept ? "accepted" : "rejected" } : x)));
  };

  const decideCross = (i: number, keep: boolean) => {
    const c = crosses[i];
    if (!c) return;
    setText((t) =>
      keep
        ? t.replace(c.marker, c.guess ?? "[crossed-out word]")
        : t.replace(new RegExp(`${esc(c.marker)}[ \\t]?|[ \\t]?${esc(c.marker)}`), ""),
    );
    setCrosses((all) => all.map((x, j) => (j === i ? { ...x, status: keep ? "kept" : "removed" } : x)));
  };

  const baseName = (upload?.fileName ?? "note").replace(/\.[^.]+$/, "");
  const downloadTxt = () => save(new Blob([text], { type: "text/plain;charset=utf-8" }), `${baseName}.txt`);
  const downloadPdf = async () => {
    const { jsPDF } = await import("jspdf");
    const doc = new jsPDF({ unit: "pt", format: "a4" });
    const cfg = PDF_STYLES[style];
    const margin = cfg.margin;
    let y = margin;
    if (cfg.title) {
      doc.setFont(cfg.font, "bold"); doc.setFontSize(cfg.size + 6);
      if (cfg.titleColor) doc.setTextColor(...cfg.titleColor);
      doc.text(baseName, style === "academic" ? 297.5 : margin, y, { align: style === "academic" ? "center" : "left" });
      doc.setTextColor(20, 20, 30);
      y += cfg.size * 3;
    }
    doc.setFont(cfg.font, "normal"); doc.setFontSize(cfg.size);
    const lines = doc.splitTextToSize(text, 595 - margin * 2);
    for (const l of lines) {
      if (y > 842 - margin) { doc.addPage(); y = margin; }
      doc.text(l, margin, y); y += cfg.size * cfg.lineHeight;
    }
    if (cfg.pageNumbers) {
      const n = doc.getNumberOfPages();
      for (let i = 1; i <= n; i++) { doc.setPage(i); doc.setFontSize(10); doc.text(`${i} / ${n}`, 297.5, 842 - 30, { align: "center" }); }
    }
    save(doc.output("blob"), `${baseName}.pdf`);
  };

  if (state === "none")
    return (
      <Shell>
        <div className="mx-auto max-w-md rounded-3xl bg-card p-8 text-center shadow-soft">
          <p className="text-lg text-deep">No note uploaded yet.</p>
          <Link to="/" className="mt-5 inline-block rounded-2xl bg-primary px-6 py-3 font-semibold text-primary-foreground">Upload a handwritten note</Link>
        </div>
      </Shell>
    );

  return (
    <Shell>
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-3xl bg-card p-4 shadow-soft">
          <h2 className="mb-3 px-2 font-display text-lg text-deep">Original</h2>
          {upload?.mimeType === "application/pdf" ? (
            <PdfPreview dataUrl={upload.dataUrl} />
          ) : upload ? (
            <img src={upload.dataUrl} alt="Your handwritten note" className="max-h-[75vh] w-full rounded-2xl bg-soft object-contain" />
          ) : null}
        </section>

        <section className="rounded-3xl bg-card p-4 shadow-soft">
          {state === "loading" && (
            <div className="flex h-full min-h-72 flex-col items-center justify-center gap-4 text-center">
              <div className="h-10 w-10 animate-spin rounded-full border-4 border-soft border-t-primary" />
              <p className="text-deep">Reading your handwriting…</p>
              <p className="text-sm text-muted-foreground">This usually takes 10–30 seconds.</p>
            </div>
          )}
          {state === "error" && (
            <div className="flex min-h-72 flex-col items-center justify-center gap-4 p-6 text-center">
              <p className="font-display text-xl text-deep">We couldn't read this one</p>
              <p className="max-w-sm text-muted-foreground">{error}</p>
              <div className="flex gap-3">
                <button onClick={() => upload && run(upload)} className="rounded-2xl bg-primary px-5 py-2.5 font-semibold text-primary-foreground">Try again</button>
                <Link to="/" className="rounded-2xl bg-soft px-5 py-2.5 font-semibold text-deep">Upload another</Link>
              </div>
            </div>
          )}
          {state === "done" && rec && (
            <>
              <div className="mb-4 flex items-center gap-2">
                <div className="flex flex-1 rounded-2xl bg-soft p-1" role="tablist">
                  {(["edit", "preview"] as const).map((t) => (
                    <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
                      className={`flex-1 rounded-xl py-2 font-medium capitalize transition ${tab === t ? "bg-card text-primary shadow-soft" : "text-deep/70"}`}>
                      {t}
                    </button>
                  ))}
                </div>
                <button onClick={() => { setNoteText(text); nav({ to: "/study" }); }}
                  className="rounded-2xl bg-deep px-4 py-2 font-medium text-primary-foreground shadow-soft transition hover:bg-primary">
                  Study mode →
                </button>
              </div>

              {(rec.overallUncertain || stillUncertain.length > 0) && (
                <div className="mb-4 rounded-2xl border border-warn/40 bg-warn/10 p-4 text-sm">
                  <p className="font-semibold text-warn-foreground">
                    {rec.overallUncertain ? "This note was hard to read — please check the text carefully." : "A few words may be wrong."}
                  </p>
                  {rec.confidenceNote && <p className="mt-1 text-warn-foreground/80">{rec.confidenceNote}</p>}
                  {stillUncertain.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      <span className="text-warn-foreground/80">Unsure about:</span>
                      {stillUncertain.map((w) => <mark key={w} className="uncertain">{w}</mark>)}
                    </div>
                  )}
                </div>
              )}

              {tab === "edit" ? (
                <div>
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <p className="text-sm text-muted-foreground">Type, or use the mic and say things like “write photosynthesis instead of fotosynthesis”.</p>
                    <button onClick={toggleVoice} disabled={voice.phase === "working"}
                      aria-label={voice.phase === "recording" ? "Stop and apply voice edit" : "Edit by voice"}
                      className={`flex shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition disabled:opacity-50 ${voice.phase === "recording" ? "bg-destructive text-destructive-foreground" : "bg-soft text-deep hover:bg-border"}`}>
                      <MicIcon active={voice.phase === "recording"} />
                      {voice.phase === "recording" ? "Stop" : voice.phase === "working" ? "Applying…" : "Edit by voice"}
                    </button>
                  </div>
                  {voice.heard && <p className="mb-2 text-sm text-muted-foreground">You said: “{voice.heard}”</p>}
                  {voice.error && <p role="alert" className="mb-2 rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">{voice.error}</p>}
                  <textarea value={text} onChange={(e) => setText(e.target.value)} aria-label="Recognized text"
                    className="min-h-[45vh] w-full resize-y rounded-2xl border border-border bg-page p-4 leading-relaxed text-foreground outline-none focus:border-primary" />
                </div>
              ) : (
                <article className={`page-${style} min-h-[45vh] whitespace-pre-wrap rounded-2xl border border-border bg-card px-6 py-8 text-foreground sm:px-10`}>
                  <Highlighted text={text} words={stillUncertain} />
                </article>
              )}

              {crosses.length > 0 && (
                <div className="mt-5">
                  <h3 className="mb-1 font-display text-deep">Crossed-out words</h3>
                  <p className="mb-2 text-sm text-muted-foreground">Accept keeps our best guess in your text; Reject removes it completely.</p>
                  <ul className="space-y-2">
                    {crosses.map((c, i) => (
                      <li key={c.marker} className="flex flex-wrap items-center gap-3 rounded-2xl border border-warn/40 bg-warn/10 px-4 py-2.5 text-sm">
                        <span>
                          <mark className="uncertain">{c.marker}</mark>{" "}
                          {c.guess ? <>→ <strong className="text-deep">{c.guess}</strong></> : <span className="text-muted-foreground">unreadable (Accept keeps a note that something was crossed out)</span>}
                        </span>
                        <span className="ml-auto flex gap-2">
                          {c.status === "pending" ? (
                            <>
                              <button onClick={() => decideCross(i, true)} className="rounded-xl bg-primary px-3 py-1.5 font-medium text-primary-foreground">Accept</button>
                              <button onClick={() => decideCross(i, false)} className="rounded-xl bg-card px-3 py-1.5 font-medium text-deep">Reject</button>
                            </>
                          ) : (
                            <span className="text-muted-foreground">{c.status === "kept" ? "Kept" : "Removed"}</span>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {suggs.length > 0 && (
                <div className="mt-5">
                  <h3 className="mb-2 font-display text-deep">Spelling suggestions</h3>
                  <ul className="space-y-2">
                    {suggs.map((s, i) => (
                      <li key={i} className="flex flex-wrap items-center gap-3 rounded-2xl bg-soft px-4 py-2.5 text-sm">
                        <span><s className="text-muted-foreground">{s.original}</s> → <strong className="text-deep">{s.suggestion}</strong></span>
                        <span className="ml-auto flex gap-2">
                          {s.status === "pending" ? (
                            <>
                              <button onClick={() => decide(i, true)} className="rounded-xl bg-primary px-3 py-1.5 font-medium text-primary-foreground">Accept</button>
                              <button onClick={() => decide(i, false)} className="rounded-xl bg-card px-3 py-1.5 font-medium text-deep">Reject</button>
                            </>
                          ) : (
                            <span className="text-muted-foreground">{s.status === "accepted" ? "Accepted" : "Kept original"}</span>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="mt-6">
                <p className="mb-2 text-sm font-medium text-deep">Page style <span className="font-normal text-muted-foreground">(Preview and PDF)</span></p>
                <div className="flex rounded-2xl bg-soft p-1" role="radiogroup" aria-label="Page style">
                  {(Object.keys(PDF_STYLES) as PageStyle[]).map((k) => (
                    <button key={k} role="radio" aria-checked={style === k} onClick={() => { setStyle(k); setTab("preview"); }}
                      className={`page-${k} flex-1 rounded-xl py-2 text-base capitalize transition ${style === k ? "bg-card text-primary shadow-soft" : "text-deep/70"}`}>
                      {k}
                    </button>
                  ))}
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-3">
                <button onClick={downloadPdf} disabled={!text.trim()} className="rounded-2xl bg-primary px-5 py-3 font-semibold text-primary-foreground shadow-soft hover:bg-deep disabled:opacity-50">Download PDF</button>
                <button onClick={downloadTxt} disabled={!text.trim()} className="rounded-2xl bg-soft px-5 py-3 font-semibold text-deep disabled:opacity-50">Download .txt</button>
              </div>
            </>
          )}
        </section>
      </div>
    </Shell>
  );
}

function PdfPreview({ dataUrl }: { dataUrl: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
        const doc = await pdfjs.getDocument({ url: dataUrl }).promise;
        const page = await doc.getPage(1);
        const canvas = canvasRef.current;
        if (!canvas || cancelled) return;
        const base = page.getViewport({ scale: 1 });
        const scale = Math.min(2, (canvas.parentElement?.clientWidth ?? 600) / base.width);
        const viewport = page.getViewport({ scale });
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const canvasContext = canvas.getContext("2d");
        if (!canvasContext) throw new Error("PDF canvas is unavailable");
        await page.render({ canvas, canvasContext, viewport }).promise;
      } catch {
        if (!cancelled) setError("We couldn't show a preview of this PDF, but you can still read its text on the right.");
      }
    })();
    return () => { cancelled = true; };
  }, [dataUrl]);

  if (error) return <p className="rounded-2xl bg-soft p-6 text-sm text-muted-foreground">{error}</p>;
  return <canvas ref={canvasRef} className="w-full rounded-2xl bg-soft" aria-label="First page of your PDF note" />;
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

function Highlighted({ text, words }: { text: string; words: string[] }) {
  if (!words.length) return <>{text}</>;
  const re = new RegExp(`(${words.map(esc).join("|")})`, "g");
  return <>{text.split(re).map((p, i) => (words.includes(p) ? <mark key={i} className="uncertain" title="We're not sure about this word">{p}</mark> : p))}</>;
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen px-4 py-6 sm:px-8">
      <header className="mx-auto mb-6 flex max-w-6xl items-center justify-between">
        <Link to="/" className="font-display text-xl font-semibold text-deep">Ink to Text</Link>
        <Link to="/" className="text-sm font-medium text-primary">New upload</Link>
      </header>
      <div className="mx-auto max-w-6xl">{children}</div>
    </main>
  );
}

function save(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
