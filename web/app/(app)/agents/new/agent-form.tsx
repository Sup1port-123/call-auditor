"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type KbMode = "text" | "pdf";

export default function AgentForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  const [kbMode, setKbMode] = useState<KbMode>("text");
  const [kbText, setKbText] = useState("");
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const form = new FormData();
      form.set("name", name);
      form.set("target", target);
      form.set("kb_mode", kbMode);
      if (kbMode === "text") {
        form.set("kb_text", kbText);
      } else if (pdfFile) {
        form.set("pdf", pdfFile);
      }
      const res = await fetch("/api/agents", { method: "POST", body: form });
      const raw = await res.text();
      let data: { id?: string; error?: string } = {};
      if (raw) {
        try {
          data = JSON.parse(raw);
        } catch {
          throw new Error(
            `Server returned a non-JSON response (${res.status}). ` +
              (raw.slice(0, 200) || "Empty body — the function likely crashed."),
          );
        }
      } else {
        throw new Error(
          `Server returned an empty ${res.status} response — the function ` +
            "crashed. Check Vercel logs / env vars.",
        );
      }
      if (!res.ok) throw new Error(data.error || "Could not create agent");
      router.push(`/agents/${data.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-7">
      <Field index="01" label="Agent name">
        <input
          type="text"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Inbound Agent"
          className="w-full rounded-2xl bg-[var(--paper)] border border-transparent focus:border-[var(--sky-500)] focus:bg-white px-5 py-3 text-sm focus:outline-none transition"
        />
      </Field>

      <Field
        index="02"
        label="Target"
        hint="One line — what this agent is for."
      >
        <input
          type="text"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          placeholder="e.g. Inbound voice support for Gromo partners"
          className="w-full rounded-2xl bg-[var(--paper)] border border-transparent focus:border-[var(--sky-500)] focus:bg-white px-5 py-3 text-sm focus:outline-none transition"
        />
      </Field>

      <Field
        index="03"
        label="Knowledge base"
        hint="Otis grades product-accuracy and compliance against this."
      >
        <div className="flex gap-2 mb-3">
          <Toggle
            active={kbMode === "text"}
            onClick={() => setKbMode("text")}
            label="Paste text"
          />
          <Toggle
            active={kbMode === "pdf"}
            onClick={() => setKbMode("pdf")}
            label="Upload PDF"
          />
        </div>

        {kbMode === "text" ? (
          <textarea
            value={kbText}
            onChange={(e) => setKbText(e.target.value)}
            rows={10}
            placeholder="Paste the agent's product facts, scripts, policies, SOPs…"
            className="w-full rounded-2xl bg-[var(--paper)] border border-transparent focus:border-[var(--sky-500)] focus:bg-white px-5 py-3 text-sm focus:outline-none transition font-mono"
          />
        ) : (
          <label className="flex flex-col items-center justify-center gap-2 rounded-2xl bg-[var(--paper)] border-2 border-dashed border-zinc-300 hover:border-[var(--sky-500)] px-6 py-10 text-center cursor-pointer transition">
            <input
              type="file"
              accept="application/pdf"
              onChange={(e) => setPdfFile(e.target.files?.[0] ?? null)}
              className="hidden"
            />
            <span className="text-2xl">📄</span>
            <span className="text-sm font-medium">
              {pdfFile ? pdfFile.name : "Click to choose a PDF"}
            </span>
            <span className="text-xs text-zinc-500">
              {pdfFile
                ? `${(pdfFile.size / 1024).toFixed(0)} KB — text will be extracted`
                : "Product docs, SOPs, policy PDFs"}
            </span>
          </label>
        )}
      </Field>

      {error && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 text-rose-700 text-sm px-5 py-3">
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="w-full rounded-full bg-[var(--ink)] text-white py-3.5 text-sm font-medium hover:bg-zinc-800 transition disabled:opacity-50 shadow-[0_10px_30px_-12px_rgba(15,23,42,0.5)]"
      >
        {submitting ? "Creating agent…" : "Create agent"}
      </button>
    </form>
  );
}

function Toggle({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-4 py-1.5 text-xs font-medium transition ${
        active
          ? "bg-[var(--ink)] text-white"
          : "bg-[var(--paper)] text-zinc-600 hover:bg-[var(--paper-strong)]"
      }`}
    >
      {label}
    </button>
  );
}

function Field({
  index,
  label,
  hint,
  children,
}: {
  index: string;
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-baseline gap-2 mb-2">
        <span className="font-mono text-xs text-zinc-400">({index})</span>
        <label className="text-sm font-medium text-[var(--ink)]">
          {label}
        </label>
      </div>
      {children}
      {hint && <p className="text-xs text-zinc-500 mt-2">{hint}</p>}
    </div>
  );
}
