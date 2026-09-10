"use client";
// AuditStatsDashboard.tsx
//
// Drop this anywhere on the Otis dashboard to show live audit stats.
// Fetches from GET /api/audits/stats?format=json
//
// Deploy to: components/AuditStatsDashboard.tsx
// Usage:
//   import AuditStatsDashboard from "@/components/AuditStatsDashboard";
//   <AuditStatsDashboard />

import { useEffect, useState, useCallback } from "react";

type AgentStat = {
  name: string;
  total: number;
  completed: number;
  avgScore: number | null;
};

type StatsData = {
  from: string;
  to: string;
  total: number;
  completed: number;
  failed: number;
  in_progress?: number;
  avgScore: number | null;
  byAgent: Record<string, AgentStat>;
  byDay: Record<string, { total: number; completed: number }>;
};

function fmt(d: string) {
  return new Date(d).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function ScorePill({ score }: { score: number | null }) {
  if (score === null) return <span className="text-zinc-400 text-sm">—</span>;
  // Clamp to 0-10 range (5 Paisa has 18.46 bug)
  const clamped = Math.min(score, 10);
  const pct = Math.round(clamped * 10);
  const color =
    pct >= 60
      ? "bg-green-100 text-green-700"
      : pct >= 40
      ? "bg-yellow-100 text-yellow-700"
      : "bg-red-100 text-red-700";
  return (
    <span
      className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-bold tabular-nums ${color}`}
    >
      {pct}%
    </span>
  );
}

// AssemblyAI cost constants
const AVG_CALL_MIN = 3.5; // avg call duration in minutes
const ASSEMBLYAI_RATE_PER_HR = 0.17; // USD — transcription $0.15 + speaker diarization $0.02
const ASSEMBLYAI_RATE_PER_MIN = ASSEMBLYAI_RATE_PER_HR / 60; // $0.002833/min
const INR_RATE = 84; // INR per USD

function calcCost(totalCalls: number) {
  const audioMin = totalCalls * AVG_CALL_MIN;
  const usd = audioMin * ASSEMBLYAI_RATE_PER_MIN;
  const inr = usd * INR_RATE;
  return { audioMin, usd, inr };
}
export default function AuditStatsDashboard() {
  const today = new Date().toISOString().slice(0, 10);
  const [from, setFrom] = useState("2026-06-29");
  const [to, setTo] = useState(today);
  const [data, setData] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dlLoading, setDlLoading] = useState(false);

  const fetchStats = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/audits/stats?from=${from}&to=${to}&format=json`
      );
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(
          (j as { error?: string }).error ?? `HTTP ${res.status}`
        );
      }
      setData(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load stats");
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  async function handleDownload() {
    setDlLoading(true);
    try {
      const res = await fetch(
        `/api/audits/stats?from=${from}&to=${to}&format=xlsx`
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `otis-stats-${from}-to-${to}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Download failed");
    } finally {
      setDlLoading(false);
    }
  }

  const agents = data
    ? Object.values(data.byAgent).sort((a, b) => b.total - a.total)
    : [];

  const notCompleted = data
    ? data.total - data.completed
    : 0;

  const scoreDisplay = data?.avgScore != null
    ? `${Math.round(Math.min(data.avgScore, 10) * 10)}%`
    : "—";

  return (
    <div className="flex flex-col gap-6 w-full">
      {/* Header row */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-4">
        <div className="flex items-center gap-3 flex-1">
          <div className="flex items-center gap-2 text-sm text-zinc-600">
            <label className="text-xs font-medium text-zinc-400 uppercase tracking-wider">From</label>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-1.5 text-sm text-zinc-800 focus:outline-none focus:ring-2 focus:ring-sky-500" />
          </div>
          <span className="text-zinc-300">→</span>
          <div className="flex items-center gap-2 text-sm text-zinc-600">
            <label className="text-xs font-medium text-zinc-400 uppercase tracking-wider">To</label>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-1.5 text-sm text-zinc-800 focus:outline-none focus:ring-2 focus:ring-sky-500" />
          </div>
        </div>
        <button onClick={handleDownload} disabled={dlLoading} className="flex items-center gap-2 rounded-full bg-[var(--ink)] px-4 py-2 text-xs font-semibold text-white hover:bg-zinc-800 transition disabled:opacity-50">
          {dlLoading ? "Generating…" : "↓ Download XLSX"}
        </button>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16 text-zinc-400 text-sm animate-pulse">Loading stats…</div>
      ) : data ? (
        <>
          <p className="text-xs text-zinc-400 -mt-2">{fmt(data.from)} → {fmt(data.to)}</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <SummaryCard label="Total Audits" value={data.total.toLocaleString("en-IN")} sub="All statuses" color="text-sky-600" />
            <SummaryCard label="Completed" value={data.completed.toLocaleString("en-IN")} sub={`${Math.round((data.completed / data.total) * 100)}% success`} color="text-green-600" />
            <SummaryCard label="Failed / Pending" value={notCompleted.toLocaleString("en-IN")} sub={`${Math.round((notCompleted / data.total) * 100)}% of total`} color="text-red-500" />
            <SummaryCard label="Avg Score" value={scoreDisplay} sub={`${data.avgScore?.toFixed(2) ?? "—"} / 10`} color="text-violet-600" />
          </div>

          {(() => {
            const { audioMin, usd, inr } = calcCost(data.total);
            return (
              <div className="rounded-2xl bg-amber-50 border border-amber-100 px-5 py-4">
                <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                  <div className="flex-1">
                    <div className="text-[10px] font-bold uppercase tracking-widest text-amber-500 mb-1">💰 AssemblyAI Cost Estimate</div>
                    <div className="flex flex-wrap gap-6 mt-2">
                      <div><div className="text-xl font-extrabold tabular-nums text-amber-700">₹{Math.round(inr).toLocaleString("en-IN")}</div><div className="text-xs text-amber-500">Total cost (INR)</div></div>
                      <div><div className="text-xl font-extrabold tabular-nums text-amber-700">${usd.toFixed(2)}</div><div className="text-xs text-amber-500">Total cost (USD)</div></div>
                      <div><div className="text-xl font-extrabold tabular-nums text-amber-700">{Math.round(audioMin).toLocaleString("en-IN")} min</div><div className="text-xs text-amber-500">Est. audio minutes</div></div>
                    </div>
                  </div>
                  <div className="text-xs text-amber-400 sm:text-right leading-5">
                    <div className="font-semibold text-amber-500">Rate: ₹0.24 / min</div>
                    <div>$0.17/hr (transcription + diarization)</div>
                    <div>Based on ~3.5 min avg call duration</div>
                    <div className="mt-1 text-[10px]">All {data.total.toLocaleString("en-IN")} submitted calls billed by AssemblyAI</div>
                  </div>
                </div>
                {/* Calculation breakdown */}
                <div className="mt-3 pt-3 border-t border-amber-100 text-[11px] text-amber-500 leading-5">
                  <div className="font-semibold text-amber-600 mb-1">How is this calculated?</div>
                  <div className="flex flex-col sm:flex-row gap-x-6 gap-y-0.5 text-amber-400">
                    <div>① $0.17/hr ÷ 60 = $0.00283/min → <span className="font-semibold text-amber-500">₹0.24/min</span></div>
                    <div>② {data.total.toLocaleString("en-IN")} calls × 3.5 min = <span className="font-semibold text-amber-500">{Math.round(audioMin).toLocaleString("en-IN")} min</span> audio</div>
                    <div>③ {Math.round(audioMin).toLocaleString("en-IN")} min × ₹0.24 = <span className="font-semibold text-amber-500">₹{Math.round(inr).toLocaleString("en-IN")}</span></div>
                  </div>
                </div>
              </div>
            );
          })()}

          {agents.length > 0 && (
            <div className="rounded-2xl bg-[var(--paper)] overflow-hidden">
              <div className="px-5 py-3 border-b border-zinc-100"><span className="text-xs font-semibold uppercase tracking-widest text-zinc-400">By Agent</span></div>
              <table className="w-full text-sm">
                <thead><tr className="border-b border-zinc-100">
                  <th className="text-left px-5 py-2.5 text-[10px] font-bold uppercase tracking-wider text-zinc-400">Agent</th>
                  <th className="text-right px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-zinc-400">Total</th>
                  <th className="text-right px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-zinc-400">Done</th>
                  <th className="text-right px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-zinc-400">Failed</th>
                  <th className="text-right px-5 py-2.5 text-[10px] font-bold uppercase tracking-wider text-zinc-400">Score</th>
                </tr></thead>
                <tbody>{agents.map((a) => (
                  <tr key={a.name} className="border-b border-zinc-50 hover:bg-zinc-50 transition">
                    <td className="px-5 py-3 font-medium text-zinc-800 max-w-[160px] truncate">{a.name}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-zinc-700">{a.total.toLocaleString("en-IN")}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-green-600 font-medium">{a.completed.toLocaleString("en-IN")}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-red-500 font-medium">{(a.total - a.completed).toLocaleString("en-IN")}</td>
                    <td className="px-5 py-3 text-right"><ScorePill score={a.avgScore} /></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}

function SummaryCard({ label, value, sub, color }: { label: string; value: string; sub: string; color: string; }) {
  return (
    <div className="rounded-2xl bg-[var(--paper)] p-4">
      <div className={`font-display text-2xl font-extrabold tabular-nums ${color}`}>{value}</div>
      <div className="text-[10px] font-bold uppercase tracking-widest text-zinc-400 mt-1">{label}</div>
      <div className="text-xs text-zinc-400 mt-0.5">{sub}</div>
    </div>
  );
}

