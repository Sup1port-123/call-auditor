"use client";

import { useRef, useState } from "react";

type State =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "done"; transcript: string }
  | { status: "error"; message: string };

export default function UploadForm() {
  const [state, setState] = useState<State>({ status: "idle" });
  const [file, setFile] = useState<File | null>(null);
  const [copied, setCopied] = useState(false);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function handleFile(f: File) {
    setFile(f);
    setState({ status: "idle" });
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  }

  async function transcribe(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    setState({ status: "loading" });

    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/transcribe", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Transcription failed");
      setState({ status: "done", transcript: data.transcript });
    } catch (err) {
      setState({ status: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }

  async function copy(text: string) {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (state.status === "loading") {
    return (
      <div className="rounded-3xl bg-[var(--paper)] p-12 flex flex-col items-center text-center gap-4">
        <div className="w-12 h-12 rounded-full border-4 border-[var(--ink)] border-t-transparent animate-spin" />
        <div className="font-display text-xl font-bold">Transcribing…</div>
        <p className="text-zinc-500 text-sm">This usually takes 10–30 seconds.</p>
      </div>
    );
  }

  if (state.status === "done") {
    return (
      <div className="space-y-5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-[var(--ink)]">Transcript</h2>
          <button
            type="button"
            onClick={() => copy(state.transcript)}
            className="text-xs px-4 py-1.5 rounded-full border border-zinc-300 hover:border-[var(--ink)] transition font-medium"
          >
            {copied ? "Copied!" : "Copy"}
          </button>
        </div>
        <textarea
          readOnly
          value={state.transcript}
          rows={20}
          className="w-full rounded-2xl bg-[var(--paper)] px-5 py-4 text-sm font-mono focus:outline-none resize-none leading-relaxed"
        />
        <button
          type="button"
          onClick={() => { setState({ status: "idle" }); setFile(null); }}
          className="text-xs text-zinc-500 hover:text-[var(--ink)] transition"
        >
          ← Transcribe another file
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={transcribe} className="space-y-7">
      {/* Drop zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        className={`cursor-pointer rounded-3xl border-2 border-dashed px-8 py-14 flex flex-col items-center gap-3 transition ${
          dragging ? "border-[var(--ink)] bg-zinc-50" : "border-zinc-300 hover:border-zinc-400"
        }`}
      >
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-zinc-400">
          <path d="M12 18.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13Z" />
          <path d="M9.5 10.5 12 8l2.5 2.5M12 8v7" />
        </svg>
        <div className="text-center">
          <p className="text-sm font-medium text-[var(--ink)]">
            {file ? file.name : "Drop an audio file here"}
          </p>
          <p className="text-xs text-zinc-500 mt-1">
            {file
              ? `${(file.size / 1024 / 1024).toFixed(1)} MB · click to change`
              : "mp3 · wav · m4a · ogg · webm"}
          </p>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="audio/*"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
        />
      </div>

      {state.status === "error" && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 text-rose-700 text-sm px-5 py-3">
          {state.message}
        </div>
      )}

      <button
        type="submit"
        disabled={!file}
        className="w-full rounded-full bg-[var(--ink)] text-white py-3.5 text-sm font-medium hover:bg-zinc-800 transition disabled:opacity-40 shadow-[0_10px_30px_-12px_rgba(15,23,42,0.5)]"
      >
        Transcribe
      </button>
    </form>
  );
}
