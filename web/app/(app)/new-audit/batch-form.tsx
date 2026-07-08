"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import LottiePlayer from "@/components/lottie-player";
import { AUDIT_PRESETS, STRICTNESS_LEVELS } from "@/lib/rubric";
import { detectUrlColumn, detectCallIdColumn, detectMobileColumn } from "@/lib/types/batch";

const MAX_URLS = 1000;

type ParsedRow = {
  url: string;
  callId: string | null;
  mobile: string | null;
};

export default function BatchForm({
  agents,
  defaultAgentId,
}: {
  agents: { id: string; name: string }[];
  defaultAgentId: string;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [parsedRows, setParsedRows] = useState<ParsedRow[]>([]);
  const [urlColumn, setUrlColumn] = useState<string | null>(null);
  const [callIdColumn, setCallIdColumn] = useState<string | null>(null);
  const [mobileColumn, setMobileColumn] = useState<string | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);

  const [agentId, setAgentId] = useState(defaultAgentId);
  const [preset, setPreset] = useState("general");
  const [strictness, setStrictness] = useState("standard");
  const [customFocus, setCustomFocus] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    setFile(f);
    setParsedRows([]);
    setUrlColumn(null);
    setCallIdColumn(null);
    setMobileColumn(null);
    setParseError(null);
    if (!f) return;

    setParsing(true);
    try {
      const XLSX = await import("xlsx");
      const buf = await f.arrayBuffer();
      const wb = XLSX.read(new Uint8Array(buf), { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      if (!sheet) throw new Error("The file has no sheets.");
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
        defval: "",
      });
      if (rows.length === 0) throw new Error("The spreadsheet has no data rows.");
      const headers = Object.keys(rows[0]);
      const col = detectUrlColumn(headers);
      if (!col) {
        throw new Error(
          `Couldn't find a recording-URL column. Name one "recording_url", "audio_url", "recording", … Columns found: ${headers.join(", ")}`,
        );
      }

      const callCol = detectCallIdColumn(headers);
      const mobCol = detectMobileColumn(headers);

      const seen = new Set<string>();
      const extracted: ParsedRow[] = [];
      for (const r of rows) {
        const v = String(r[col] ?? "").trim();
        if (/^https?:\/\//i.test(v) && !seen.has(v)) {
          seen.add(v);
          extracted.push({
            url: v,
            callId: callCol ? String(r[callCol] ?? "").trim() || null : null,
            mobile: mobCol ? String(r[mobCol] ?? "").trim() || null : null,
          });
        }
      }
      if (extracted.length === 0) {
        throw new Error(`Column "${col}" has no valid http(s) URLs.`);
      }
      if (extracted.length > MAX_URLS) {
        throw new Error(
          `Too many recordings (${extracted.length}). Max ${MAX_URLS} per batch.`,
        );
      }
      setUrlColumn(col);
      setCallIdColumn(callCol);
      setMobileColumn(mobCol);
      setParsedRows(extracted);
    } catch (err) {
      setParseError(err instanceof Error ? err.message : String(err));
    } finally {
      setParsing(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) {
      setError("Choose a CSV or Excel file first.");
      return;
    }
    if (parsedRows.length === 0) {
      setError(parseError ?? "No valid URLs found in the file.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/batches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: file.name,
          url_column: urlColumn,
          rows: parsedRows.map((r) => ({
            url: r.url,
            call_id: r.callId,
            mobile: r.mobile,
          })),
          agent_id: agentId,
          preset,
          strictness,
          custom_focus: customFocus,
        }),
      });
      const raw = await res.text();
      let data: { id?: string; error?: string } = {};
      if (raw) {
        try {
          data = JSON.parse(raw);
        } catch {
          throw new Error(`Server returned a non-JSON response (${res.status}).`);
        }
      } else {
        throw new Error(`Empty ${res.status} response — the function crashed.`);
      }
      if (!res.ok) throw new Error(data.error || "Upload failed");
      router.push(`/batches/${data.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  }

  if (submitting) {
    return (
      <div className="rounded-3xl bg-[var(--paper)] p-12 flex flex-col items-center text-center">
        <LottiePlayer
          src="/lottie/interactive-volume.lottie"
          className="w-48 h-48"
        />
        <div className="font-display text-xl font-bold mt-2">
          Queueing {parsedRows.length} calls…
        </div>
        <div className="text-zinc-500 text-sm mt-2">
          We&apos;ll send you to the batch page in a second.
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-7">
      <Field
        index="01"
        label="Spreadsheet"
        hint='CSV or Excel (.xlsx). Otis auto-detects recording_url, call_id, and mobile number columns.'
      >
        <input
          ref={fileRef}
          type="file"
          accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          onChange={onFileChange}
          className="hidden"
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="w-full rounded-2xl border-2 border-dashed border-zinc-300 hover:border-[var(--sky-500)] bg-[var(--paper)] px-6 py-10 text-center transition"
        >
          {file ? (
            <>
              <div className="text-2xl mb-1">📄</div>
              <div className="font-medium text-[var(--ink)]">{file.name}</div>
              <div className="text-xs text-zinc-500 mt-1">
                {(file.size / 1024).toFixed(0)} KB — click to choose a
                different file
              </div>
            </>
          ) : (
            <>
              <div className="text-2xl mb-1">📊</div>
              <div className="font-medium text-[var(--ink)]">
                Click to choose a CSV or Excel file
              </div>
              <div className="text-xs text-zinc-500 mt-1">
                One row per recording
              </div>
            </>
          )}
        </button>

        {parsing && (
          <div className="text-xs text-zinc-500 mt-2">Reading file…</div>
        )}
        {parseError && (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 text-rose-700 text-sm px-4 py-3 mt-3">
            {parseError}
          </div>
        )}
        {parsedRows.length > 0 && urlColumn && (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 text-emerald-800 text-sm px-4 py-3 mt-3 space-y-1">
            <div>
              Found{" "}
              <strong className="tabular-nums">{parsedRows.length}</strong>{" "}
              recording URLs in column <strong>{urlColumn}</strong>.
            </div>
            {callIdColumn && (
              <div className="text-xs text-emerald-700">
                ✓ Call ID column detected: <strong>{callIdColumn}</strong>
              </div>
            )}
            {mobileColumn && (
              <div className="text-xs text-emerald-700">
                ✓ Mobile number column detected: <strong>{mobileColumn}</strong>
              </div>
            )}
          </div>
        )}
      </Field>

      <Field
        index="02"
        label="Agent"
        hint="Every call in the batch is graded against this agent's knowledge base."
      >
        <select
          value={agentId}
          onChange={(e) => setAgentId(e.target.value)}
          className="w-full rounded-2xl bg-[var(--paper)] border border-transparent focus:border-[var(--sky-500)] focus:bg-white px-4 py-3 text-sm focus:outline-none transition"
        >
          <option value="">No agent / general audit</option>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </Field>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Field index="03" label="Preset" hint="What kind of audit is this?">
          <select
            value={preset}
            onChange={(e) => setPreset(e.target.value)}
            className="w-full rounded-2xl bg-[var(--paper)] border border-transparent focus:border-[var(--sky-500)] focus:bg-white px-4 py-3 text-sm focus:outline-none transition"
          >
            {Object.entries(AUDIT_PRESETS).map(([key, p]) => (
              <option key={key} value={key}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>

        <Field index="04" label="Strictness" hint="How tough should Otis be?">
          <select
            value={strictness}
            onChange={(e) => setStrictness(e.target.value)}
            className="w-full rounded-2xl bg-[var(--paper)] border border-transparent focus:border-[var(--sky-500)] focus:bg-white px-4 py-3 text-sm focus:outline-none transition"
          >
            {Object.keys(STRICTNESS_LEVELS).map((k) => (
              <option key={k} value={k}>
                {k.charAt(0).toUpperCase() + k.slice(1)}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <Field
        index="05"
        label="Custom focus (optional)"
        hint="Applied to every call in the batch."
      >
        <textarea
          value={customFocus}
          onChange={(e) => setCustomFocus(e.target.value)}
          rows={2}
          placeholder="e.g. did the agent mention the 18% interest cap?"
          className="w-full rounded-2xl bg-[var(--paper)] border border-transparent focus:border-[var(--sky-500)] focus:bg-white px-5 py-3 text-sm focus:outline-none transition"
        />
      </Field>

      {error && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 text-rose-700 text-sm px-5 py-3">
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={submitting || parsing || parsedRows.length === 0}
        className="w-full rounded-full bg-[var(--ink)] text-white py-3.5 text-sm font-medium hover:bg-zinc-800 transition disabled:opacity-50 shadow-[0_10px_30px_-12px_rgba(15,23,42,0.5)]"
      >
        {parsedRows.length > 0
          ? `Queue ${parsedRows.length} audits`
          : "Queue batch audit"}
      </button>
    </form>
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
