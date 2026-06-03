"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Agent } from "@/lib/types/agent";

type KbMode = "text" | "pdf";

export default function AgentEditor({ agent }: { agent: Agent }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);

  const [name, setName] = useState(agent.name);
  const [target, setTarget] = useState(agent.target ?? "");
  const [kbMode, setKbMode] = useState<KbMode>("text");
  const [kbText, setKbText] = useState(agent.knowledge_base ?? "");
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function startEditing() {
    // Reset the form to the persisted values each time we open it.
    setName(agent.name);
    setTarget(agent.target ?? "");
    setKbMode("text");
    setKbText(agent.knowledge_base ?? "");
    setPdfFile(null);
    setError(null);
    setEditing(true);
  }

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
      const res = await fetch(`/api/agents/${agent.id}`, {
        method: "PATCH",
        body: form,
      });
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
      if (!res.ok) throw new Error(data.error || "Could not save agent");
      setEditing(false);
      setSubmitting(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  }

  const kb = agent.knowledge_base ?? "";

  if (!editing) {
    return (
      <>
        <div className="flex items-start gap-5 mb-10">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-[var(--sky-200)] to-[var(--violet-500)] shrink-0" />
          <div className="flex-1">
            <div className="text-xs uppercase tracking-[0.25em] text-[var(--sky-700)] font-semibold mb-2">
              Agent
            </div>
            <h1 className="font-display text-4xl font-extrabold tracking-tight leading-none">
              {agent.name}
            </h1>
            {agent.target && (
              <p className="text-zinc-600 mt-2 max-w-xl">{agent.target}</p>
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-3 mb-10">
          <Link
            href={`/new-audit?agent=${agent.id}`}
            className="rounded-full bg-[var(--ink)] text-white px-5 py-2 text-sm font-medium hover:bg-zinc-800 transition"
          >
            + Audit a call for this agent
          </Link>
          <button
            type="button"
            onClick={startEditing}
            className="rounded-full bg-[var(--paper)] text-[var(--ink)] px-5 py-2 text-sm font-medium hover:bg-[var(--paper-strong)] transition"
          >
            Edit knowledge base
          </button>
        </div>

        <Section index="01" title="Knowledge base">
          {kb ? (
            <>
              <p className="text-xs text-zinc-500 mb-3">
                {kb.length.toLocaleString()} characters · injected into the
                scoring prompt for every audit tied to this agent.
              </p>
              <pre className="text-zinc-700 text-sm leading-relaxed whitespace-pre-wrap font-mono max-h-[480px] overflow-y-auto rounded-xl bg-white p-4">
                {kb}
              </pre>
            </>
          ) : (
            <p className="text-sm text-zinc-500">No knowledge base attached.</p>
          )}
        </Section>
      </>
    );
  }

  return (
    <form onSubmit={submit} className="mb-6">
      <div className="flex items-center justify-between mb-8">
        <div className="text-xs uppercase tracking-[0.25em] text-[var(--sky-700)] font-semibold">
          Editing agent
        </div>
        <button
          type="button"
          onClick={() => setEditing(false)}
          className="text-xs uppercase tracking-[0.25em] text-zinc-400 hover:text-zinc-600 transition"
        >
          Cancel
        </button>
      </div>

      <div className="space-y-7">
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

        <Field index="02" label="Target" hint="One line — what this agent is for.">
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
              label="Edit text"
            />
            <Toggle
              active={kbMode === "pdf"}
              onClick={() => setKbMode("pdf")}
              label="Replace with PDF"
            />
          </div>

          {kbMode === "text" ? (
            <>
              <textarea
                value={kbText}
                onChange={(e) => setKbText(e.target.value)}
                rows={16}
                placeholder="Paste the agent's product facts, scripts, policies, SOPs…"
                className="w-full rounded-2xl bg-[var(--paper)] border border-transparent focus:border-[var(--sky-500)] focus:bg-white px-5 py-3 text-sm focus:outline-none transition font-mono"
              />
              <p className="text-xs text-zinc-500 mt-2">
                {kbText.length.toLocaleString()} characters
              </p>
            </>
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
                  ? `${(pdfFile.size / 1024).toFixed(0)} KB — text will be extracted and replace the current knowledge base`
                  : "Replaces the current knowledge base entirely"}
              </span>
            </label>
          )}
        </Field>

        {error && (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 text-rose-700 text-sm px-5 py-3">
            {error}
          </div>
        )}

        <div className="flex gap-3">
          <button
            type="submit"
            disabled={submitting}
            className="rounded-full bg-[var(--ink)] text-white px-7 py-3.5 text-sm font-medium hover:bg-zinc-800 transition disabled:opacity-50 shadow-[0_10px_30px_-12px_rgba(15,23,42,0.5)]"
          >
            {submitting ? "Saving…" : "Save changes"}
          </button>
          <button
            type="button"
            onClick={() => setEditing(false)}
            disabled={submitting}
            className="rounded-full bg-[var(--paper)] text-[var(--ink)] px-7 py-3.5 text-sm font-medium hover:bg-[var(--paper-strong)] transition disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      </div>
    </form>
  );
}

function Section({
  index,
  title,
  children,
}: {
  index: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-6">
      <div className="rounded-3xl bg-[var(--paper)] p-7 relative">
        <span className="absolute top-5 right-6 font-mono text-xs text-zinc-400">
          ({index})
        </span>
        <div className="font-display text-xl font-bold mb-4">{title}</div>
        {children}
      </div>
    </section>
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
        <label className="text-sm font-medium text-[var(--ink)]">{label}</label>
      </div>
      {children}
      {hint && <p className="text-xs text-zinc-500 mt-2">{hint}</p>}
    </div>
  );
}
