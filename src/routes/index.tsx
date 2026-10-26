import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { setUpload } from "@/lib/upload-store";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Ink to Text — Turn handwritten notes into digital text" },
      { name: "description", content: "Upload a photo or PDF of your handwritten notes and get editable text plus a clean PDF." },
      { property: "og:title", content: "Ink to Text — Handwritten notes to digital text" },
      { property: "og:description", content: "Upload handwritten notes, review the text, download as PDF or .txt." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

const ACCEPT = ["image/png", "image/jpeg", "application/pdf"];

function Index() {
  const nav = useNavigate();
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");

  const onFile = (f?: File) => {
    setError("");
    if (!f) return;
    if (!ACCEPT.includes(f.type)) return setError("Please choose a PNG, JPG or PDF file.");
    if (f.size > 10 * 1024 * 1024) return setError("That file is over 10 MB. Try a smaller photo.");
    const r = new FileReader();
    r.onload = () => {
      setUpload({ dataUrl: String(r.result), mimeType: f.type, fileName: f.name });
      nav({ to: "/editor" });
    };
    r.onerror = () => setError("We couldn't open that file. Please try another.");
    r.readAsDataURL(f);
  };

  return (
    <main className="min-h-screen px-5 py-12 sm:py-20">
      <div className="mx-auto max-w-2xl text-center">
        <p className="font-display text-lg text-primary">Ink to Text</p>
        <h1 className="mt-4 font-display text-4xl font-semibold leading-tight text-deep sm:text-5xl">
          Your handwritten notes, ready to edit.
        </h1>
        <p className="mx-auto mt-5 max-w-lg text-lg text-muted-foreground">
          Snap a photo of your notes. We'll read the handwriting, flag anything unclear, and give you clean text and a PDF.
        </p>
        <div
          className="mt-10 rounded-3xl border-2 border-dashed border-primary/30 bg-card p-10 shadow-soft"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); onFile(e.dataTransfer.files[0]); }}
        >
          <button
            onClick={() => input.current?.click()}
            className="rounded-2xl bg-primary px-8 py-4 text-lg font-semibold text-primary-foreground shadow-soft transition hover:bg-deep"
          >
            Upload a handwritten note
          </button>
          <p className="mt-4 text-sm text-muted-foreground">PNG, JPG or PDF · up to 10 MB · or drop it here</p>
          <input ref={input} type="file" accept=".png,.jpg,.jpeg,.pdf" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
          {error && <p role="alert" className="mt-4 rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</p>}
        </div>
        <ol className="mt-12 grid gap-4 text-left sm:grid-cols-3">
          {["Upload a photo or PDF", "Review flagged words & spelling", "Download PDF or .txt"].map((s, i) => (
            <li key={s} className="rounded-2xl bg-soft p-5">
              <span className="font-display text-2xl text-primary">{i + 1}</span>
              <p className="mt-1 font-medium text-deep">{s}</p>
            </li>
          ))}
        </ol>
      </div>
    </main>
  );
}
