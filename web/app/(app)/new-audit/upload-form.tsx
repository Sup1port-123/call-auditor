"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import LottiePlayer from "@/components/lottie-player";
import { createClient } from "@/lib/supabase/client";
import { AUDIT_PRESETS, STRICTNESS_LEVELS } from "@/lib/rubric";
import { classifyUpload, UPLOAD_ACCEPT, type UploadKind } from "@/lib/upload-formats";

// Transcript files are posted through a Vercel function, which caps bodies at
// 4.5 MB. Recordings go straight to storage instead.
const MAX_TRANSCRIPT_BYTES = 4 * 1024 * 1024;

const KIND_LABEL: Record<UploadKind, string> = {
  recording: "Call recording — Otis will transcribe and audit it",
  transcript: "Transcript — Otis will audit the text directly",
  spreadsheet: "Spreadsheet of recording URLs — opens as a batch",
};

const inputClass =
  "w-full rounded-2xl bg-[var(--paper)] border border-transparent focus:border-[var(--sky-500)] focus:bg-white px-4 py-3 text-sm focus:outline-none transition";

export default function UploadForm({
  agents,
  defaultAgentId,
  onSpreadsheet,
}: {
  agents: { id: string; name: string }[];
  defaultAgentId: string;
  onSpreadsheet: (file: File) => void;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [agentId, setAgentId] = useState(defaultAgentId);
  const [preset, setPreset] = useState("general");
  const [strictness, setStrictness] = useState("standard");
  const [customFocus, setCustomFocus] = useState("");
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const kind = file ? classifyUpload(file.name, file.type) : null;

  function handleFile(f: File) {
    setError(null);
    if (classifyUpload(f.name, f.type) === "spreadsheet") {
      onSpreadsheet(f);
      return;
    }
    setFile(f);
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  }

  async function auditRecording(f: File): Promise<string> {
    setProgress("Uploading recording…");
    const urlRes = await fetch("/api/audits/upload-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file_name: f.name, mime_type: f.type }),
    });
    const target = await urlRes.json();
    if (!urlRes.ok) throw new Error(target.error || "Could not prepare upload");

    const { error: uploadErr } = await createClient()
      .storage.from(target.bucket)
      .uploadToSignedUrl(target.path, target.token, f, {
        contentType: f.type || "application/octet-stream",
      });
    if (uploadErr) throw new Error(`Upload failed: ${uploadErr.message}`);

    setProgress("Sending Otis on it…");
    const res = await fetch("/api/audits/upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path: target.path,
        agent_id: agentId || null,
        preset,
        strictness,
        custom_focus: customFocus,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Submission failed");
    return data.id;
  }

  async function auditTranscript(f: File): Promise<string> {
    if (f.size > MAX_TRANSCRIPT_BYTES) {
      throw new Error("Transcript files must be under 4 MB.");
    }
    setProgress("Reading transcript and scoring…");
    const form = new FormData();
    form.append("file", f);
    form.append("agent_id", agentId);
    form.append("preset", preset);
    form.append("strictness", strictness);
    form.append("custom_focus", customFocus);
    const res = await fetch("/api/audits/transcript-file", { method: "POST", body: form });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Submission failed");
    return data.id;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file || !kind) return;
    setError(null);
    try {
      const id = kind === "recording" ? await auditRecording(file) : await auditTranscript(file);
      router.push(`/audits/${id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setProgress(null);
    }
  }

  if (progress) {
    return (
      <div className="rounded-3xl bg-[var(--paper)] p-12 flex flex-col items-center text-center">
        <LottiePlayer src="/lottie/interactive-volume.lottie" className="w-48 h-48" />
        <div className="font-display text-xl font-bold mt-2">{progress}</div>
        <div className="text-zinc-500 text-sm mt-2">
          We&apos;ll send you to the audit page when it&apos;s on its way.
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-7">
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
            {file ? file.name : "Drop any call file here"}
          </p>
          <p className="text-xs text-zinc-500 mt-1">
            {file
              ? `${(file.size / 1024 / 1024).toFixed(1)} MB · click to change`
              : "Recordings (mp3 · wav · m4a · aac · amr · ogg · flac · mp4 …) · transcripts (txt · pdf · docx) · spreadsheets (csv · xlsx · ods …)"}
          </p>
          {file && (
            <p className={`text-xs mt-2 font-medium ${kind ? "text-[var(--sky-700)]" : "text-rose-600"}`}>
              {kind ? KIND_LABEL[kind] : "Otis can't audit this file type."}
            </p>
          )}
        </div>
        <input
          ref={inputRef}
          type="file"
          accept={UPLOAD_ACCEPT}
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }}
        />
      </div>

      <div>
        <label className="text-sm font-medium text-[var(--ink)] block mb-2">Agent</label>
        <select value={agentId} onChange={(e) => setAgentId(e.target.value)} className={inputClass}>
          <option value="">No agent / general audit</option>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <label className="text-sm font-medium text-[var(--ink)] block mb-2">Preset</label>
          <select value={preset} onChange={(e) => setPreset(e.target.value)} className={inputClass}>
            {Object.entries(AUDIT_PRESETS).map(([key, p]) => (
              <option key={key} value={key}>{p.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-sm font-medium text-[var(--ink)] block mb-2">Strictness</label>
          <select value={strictness} onChange={(e) => setStrictness(e.target.value)} className={inputClass}>
            {Object.keys(STRICTNESS_LEVELS).map((k) => (
              <option key={k} value={k}>{k.charAt(0).toUpperCase() + k.slice(1)}</option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className="text-sm font-medium text-[var(--ink)] block mb-2">Custom focus (optional)</label>
        <textarea
          value={customFocus}
          onChange={(e) => setCustomFocus(e.target.value)}
          rows={3}
          placeholder="e.g. did the AI mention the 18% interest cap?"
          className={inputClass}
        />
      </div>

      {error && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 text-rose-700 text-sm px-5 py-3">
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={!file || !kind}
        className="w-full rounded-full bg-[var(--ink)] text-white py-3.5 text-sm font-medium hover:bg-zinc-800 transition disabled:opacity-40 shadow-[0_10px_30px_-12px_rgba(15,23,42,0.5)]"
      >
        Run audit
      </button>
    </form>
  );
}
