"use client";

import { useEffect, useState } from "react";

type AuditRow = { id: string; timestamp: string; llm_provider: string | null; overall_score: number | null };
type DimRow = { key: string; name: string; min: number; max: number; otis: number | null; jev: number | null; confidence: number | null; rationale: string };
type CheckRow = { key: string; name: string; otis: boolean; jev: boolean | null; probability: number | null; evidence: string };
type Result = {
  audit: { id: string; timestamp: string; llm_provider: string | null; summary: string | null };
  otisPercent: number | null;
  jevPercent: number | null;
  dimensions: DimRow[];
  checks: CheckRow[];
  jev: { model: string; ms: number; costUsd: number | null; inputTokens: number | null };
};

const band = (p: number | null) =>
  p == null ? "–" : p >= 70 ? "Excellent" : p >= 55 ? "Acceptable" : "Needs Improvement";
const fmtMs = (ms: number) => (ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} sec`);
const fmtCost = (c: number | null) => (c == null ? "–" : c < 0.01 ? `$${c.toFixed(5)}` : `$${c.toFixed(3)}`);

export default function JevComparePage() {
  const [audits, setAudits] = useState<AuditRow[]>([]);
  const [id, setId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [results, setResults] = useState<Result[]>([]);

  useEffect(() => {
    fetch("/api/jev-compare")
      .then((r) => r.json())
      .then((d) => setAudits(d.audits || []))
      .catch(() => setAudits([]));
  }, []);

  async function run(auditId: string) {
    if (!auditId) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/jev-compare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: auditId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Comparison failed");
      setResults((prev) => [data as Result, ...prev.filter((r) => r.audit.id !== auditId)]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const latest = results[0];
  const withBoth = results.filter((r) => r.otisPercent != null && r.jevPercent != null);
  const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null);
  const allChecks = results.flatMap((r) => r.checks).filter((c) => c.jev != null);
  const agree = allChecks.filter((c) => c.jev === c.otis).length;

  return (
    <div className="px-10 py-10 max-w-6xl">
      <h1 className="font-display text-3xl font-bold tracking-tight">Jev vs Otis</h1>
      <p className="text-sm text-zinc-500 mt-2 max-w-2xl">
        Pick a call Otis has already audited. The same transcript goes to Jev, and both scores show side by side.
        Nothing is saved or changed in Otis.
      </p>

      <div className="mt-6 flex flex-wrap gap-3 items-end">
        <label className="flex flex-col gap-1 text-xs text-zinc-500 grow min-w-[260px]">
          Recent audits
          <select
            value={id}
            onChange={(e) => setId(e.target.value)}
            className="border border-zinc-200 rounded-lg px-3 py-2 text-sm text-zinc-800 bg-white"
          >
            <option value="">Select an audit…</option>
            {audits.map((a) => (
              <option key={a.id} value={a.id}>
                {new Date(a.timestamp).toLocaleString()} · {a.llm_provider || "?"} · score {a.overall_score ?? "–"} · {a.id}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-zinc-500 min-w-[220px]">
          …or paste an audit ID
          <input
            value={id}
            onChange={(e) => setId(e.target.value)}
            className="border border-zinc-200 rounded-lg px-3 py-2 text-sm text-zinc-800"
          />
        </label>
        <button
          onClick={() => run(id)}
          disabled={busy || !id}
          className="rounded-lg bg-[var(--ink)] text-white text-sm font-semibold px-5 py-2.5 disabled:opacity-50"
        >
          {busy ? "Asking Jev…" : "Compare with Jev"}
        </button>
      </div>
      {error && <p className="mt-3 text-sm font-semibold text-red-600">{error}</p>}

      {results.length > 0 && (
        <div className="mt-8 grid grid-cols-2 md:grid-cols-5 gap-3">
          {[
            ["Calls compared", String(results.length)],
            ["Otis avg", avg(withBoth.map((r) => r.otisPercent as number)) ?? "–"],
            ["Jev avg", avg(withBoth.map((r) => r.jevPercent as number)) ?? "–"],
            ["Avg gap (points)", avg(withBoth.map((r) => Math.abs((r.jevPercent as number) - (r.otisPercent as number)))) ?? "–"],
            ["Script checks agree", allChecks.length ? `${agree} / ${allChecks.length}` : "–"],
          ].map(([label, value]) => (
            <div key={label} className="rounded-2xl bg-zinc-50 px-4 py-3">
              <div className="text-xl font-bold">{value}</div>
              <div className="text-xs text-zinc-500">{label}</div>
            </div>
          ))}
        </div>
      )}

      {latest && (
        <div className="mt-8">
          <div className="text-xs text-zinc-500">
            {new Date(latest.audit.timestamp).toLocaleString()} · audit {latest.audit.id}
          </div>
          <div className="mt-3 grid md:grid-cols-2 gap-4">
            <div className="rounded-2xl border border-zinc-200 p-5">
              <div className="text-sm font-semibold">Otis ({latest.audit.llm_provider || "LLM"})</div>
              <div className="text-4xl font-bold mt-2">
                {latest.otisPercent ?? "–"} <span className="text-base font-medium text-zinc-400">/ 100</span>
              </div>
              <div className="text-xs font-semibold text-zinc-600 mt-1">{band(latest.otisPercent)}</div>
              {latest.audit.summary && <p className="text-sm text-zinc-600 mt-3">{latest.audit.summary}</p>}
            </div>
            <div className="rounded-2xl border border-zinc-200 p-5">
              <div className="text-sm font-semibold">Jev ({latest.jev.model})</div>
              <div className="text-4xl font-bold mt-2">
                {latest.jevPercent ?? "–"} <span className="text-base font-medium text-zinc-400">/ 100</span>
              </div>
              <div className="text-xs font-semibold text-zinc-600 mt-1">{band(latest.jevPercent)}</div>
              <p className="text-sm text-zinc-600 mt-3">
                Time {fmtMs(latest.jev.ms)} · Cost {fmtCost(latest.jev.costUsd)}. Jev gives scores only, no written feedback.
              </p>
            </div>
          </div>

          <h2 className="text-sm font-semibold mt-8 mb-2">Parameters</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-zinc-400 border-b border-zinc-200">
                  <th className="py-2 pr-3">Parameter</th>
                  <th className="py-2 px-3 text-right">Range</th>
                  <th className="py-2 px-3 text-right">Otis</th>
                  <th className="py-2 px-3 text-right">Jev</th>
                  <th className="py-2 px-3 text-right">Gap</th>
                  <th className="py-2 px-3 text-right">Jev confidence</th>
                  <th className="py-2 pl-3">Otis rationale</th>
                </tr>
              </thead>
              <tbody>
                {latest.dimensions.map((d) => {
                  const gap = d.otis != null && d.jev != null ? Math.round((d.jev - d.otis) * 10) / 10 : null;
                  const far = gap != null && Math.abs(gap) / (d.max - d.min || 1) > 0.3;
                  return (
                    <tr key={d.key} className="border-b border-zinc-100 align-top">
                      <td className="py-2 pr-3 font-semibold">{d.name}</td>
                      <td className="py-2 px-3 text-right text-zinc-500">{d.min}–{d.max}</td>
                      <td className="py-2 px-3 text-right">{d.otis ?? "N/A"}</td>
                      <td className="py-2 px-3 text-right">{d.jev ?? "–"}</td>
                      <td className={`py-2 px-3 text-right font-semibold ${far ? "text-red-600" : "text-zinc-700"}`}>
                        {gap == null ? "–" : `${gap > 0 ? "+" : ""}${gap}`}
                      </td>
                      <td className="py-2 px-3 text-right">{d.confidence != null ? `${Math.round(d.confidence * 100)}%` : "–"}</td>
                      <td className="py-2 pl-3 text-zinc-500">{d.rationale}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {latest.checks.length > 0 && (
            <>
              <h2 className="text-sm font-semibold mt-8 mb-2">Script checks</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wide text-zinc-400 border-b border-zinc-200">
                      <th className="py-2 pr-3">Check</th>
                      <th className="py-2 px-3">Otis</th>
                      <th className="py-2 px-3">Jev</th>
                      <th className="py-2 px-3 text-right">Jev “yes” probability</th>
                      <th className="py-2 pl-3">Otis evidence</th>
                    </tr>
                  </thead>
                  <tbody>
                    {latest.checks.map((c) => (
                      <tr key={c.key} className="border-b border-zinc-100 align-top">
                        <td className="py-2 pr-3 font-semibold">{c.name}</td>
                        <td className="py-2 px-3">{c.otis ? "Pass" : "Fail"}</td>
                        <td className={`py-2 px-3 font-semibold ${c.jev != null && c.jev !== c.otis ? "text-red-600" : ""}`}>
                          {c.jev == null ? "–" : c.jev ? "Pass" : "Fail"}
                          {c.jev != null && c.jev !== c.otis ? " (differs)" : ""}
                        </td>
                        <td className="py-2 px-3 text-right">{c.probability != null ? `${Math.round(c.probability * 100)}%` : "–"}</td>
                        <td className="py-2 pl-3 text-zinc-500">{c.evidence}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      {results.length > 1 && (
        <>
          <h2 className="text-sm font-semibold mt-10 mb-2">All calls compared this session</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-zinc-400 border-b border-zinc-200">
                <th className="py-2 pr-3">Audit</th>
                <th className="py-2 px-3 text-right">Otis</th>
                <th className="py-2 px-3 text-right">Jev</th>
                <th className="py-2 px-3 text-right">Jev time</th>
              </tr>
            </thead>
            <tbody>
              {results.map((r) => (
                <tr key={r.audit.id} className="border-b border-zinc-100">
                  <td className="py-2 pr-3 text-zinc-500">{r.audit.id}</td>
                  <td className="py-2 px-3 text-right">{r.otisPercent ?? "–"}</td>
                  <td className="py-2 px-3 text-right">{r.jevPercent ?? "–"}</td>
                  <td className="py-2 px-3 text-right">{fmtMs(r.jev.ms)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
