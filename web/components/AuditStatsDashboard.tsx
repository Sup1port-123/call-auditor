"use client";
// components/AuditStatsDashboard.tsx
import { useEffect, useState, useCallback } from "react";

type AgentStat = { name: string; total: number; completed: number; avgScore: number | null };
type StatsData = {
  from: string; to: string; total: number; completed: number;
  failed: number; in_progress: number; avgScore: number | null;
  byAgent: Record<string, AgentStat>;
};

function pct(score: number | null): string {
  if (score === null) return "—";
  return Math.round(Math.min(score, 10) * 10) + "%";
}

function ScorePill({ score }: { score: number | null }) {
  if (score === null) return <span className="text-zinc-400 text-sm">—</span>;
  const p = Math.round(Math.min(score, 10) * 10);
  const cls = p >= 60 ? "bg-green-100 text-green-700" : p >= 40 ? "bg-yellow-100 text-yellow-700" : "bg-red-100 text-red-700";
  return <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-bold ${cls}`}>{p}%</span>;
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
    setLoading(true); setError(null);
    try {
      const res = await fetch(`/api/audits/stats?from=${from}&to=${to}&format=json`);
      if (!res.ok) throw new Error((await res.json().catch(()=>({}))).error ?? `HTTP ${res.status}`);
      setData(await res.json());
    } catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
    finally { setLoading(false); }
  }, [from, to]);

  useEffect(() => { fetchStats(); }, [fetchStats]);

  async function handleDownload() {
    setDlLoading(true);
    try {
      const res = await fetch(`/api/audits/stats?from=${from}&to=${to}&format=xlsx`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `otis-stats-${from}-to-${to}.xlsx`; a.click();
      URL.revokeObjectURL(url);
    } catch (e) { alert(e instanceof Error ? e.message : "Download failed"); }
    finally { setDlLoading(false); }
  }

  const agents = data ? Object.values(data.byAgent).sort((a, b) => b.total - a.total) : [];
  const notDone = data ? data.total - data.completed : 0;

  return (
    <div className="flex flex-col gap-6 w-full">
      {/* Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex items-center gap-2 flex-1">
          <label className="text-xs font-medium text-zinc-400 uppercase tracking-wider">From</label>
          <input type="date" value={from} onChange={e => setFrom(e.target.value)}
            className="rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-1.5 text-sm text-zinc-800 focus:outline-none focus:ring-2 focus:ring-sky-500" />
          <span className="text-zinc-300">→</span>
          <label className="text-xs font-medium text-zinc-400 uppercase tracking-wider">To</label>
          <input type="date" value={to} onChange={e => setTo(e.target.value)}
            className="rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-1.5 text-sm text-zinc-800 focus:outline-none focus:ring-2 focus:ring-sky-500" />
        </div>
        <button onClick={handleDownload} disabled={dlLoading}
          className="flex items-center gap-2 rounded-full bg-[var(--ink)] px-4 py-2 text-xs font-semibold text-white hover:bg-zinc-800 transition disabled:opacity-50">
          {dlLoading ? "Generating…" : "↓ Download XLSX"}
        </button>
      </div>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>}

      {loading ? (
        <div className="flex items-center justify-center py-12 text-zinc-400 text-sm animate-pulse">Loading stats…</div>
      ) : data ? (
        <>
          <p className="text-xs text-zinc-400 -mt-2">{data.from} → {data.to}</p>
          {/* KPI cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: "Total Audits", value: data.total.toLocaleString("en-IN"), sub: "All statuses", color: "text-sky-600" },
              { label: "Completed", value: data.completed.toLocaleString("en-IN"), sub: Math.round(data.completed/data.total*100)+"%", color: "text-green-600" },
              { label: "Failed / Pending", value: notDone.toLocaleString("en-IN"), sub: Math.round(notDone/data.total*100)+"%", color: "text-red-500" },
              { label: "Avg Score", value: pct(data.avgScore), sub: (data.avgScore?.toFixed(2) ?? "—")+"/10", color: "text-violet-600" },
            ].map(c => (
              <div key={c.label} className="rounded-2xl bg-[var(--paper)] p-4">
                <div className={`font-display text-2xl font-extrabold tabular-nums ${c.color}`}>{c.value}</div>
                <div className="text-[10px] font-bold uppercase tracking-widest text-zinc-400 mt-1">{c.label}</div>
                <div className="text-xs text-zinc-400 mt-0.5">{c.sub}</div>
              </div>
            ))}
          </div>

          {/* Agent table */}
          {agents.length > 0 && (
            <div className="rounded-2xl bg-[var(--paper)] overflow-hidden">
              <div className="px-5 py-3 border-b border-zinc-100">
                <span className="text-xs font-semibold uppercase tracking-widest text-zinc-400">By Agent</span>
              </div>
              <table className="w-full text-sm">
                <thead><tr className="border-b border-zinc-100">
                  {["Agent","Total","Done","Failed","Score"].map(h => (
                    <th key={h} className={`${h==="Agent"?"text-left px-5":"text-right px-4"} py-2.5 text-[10px] font-bold uppercase tracking-wider text-zinc-400`}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {agents.map(a => (
                    <tr key={a.name} className="border-b border-zinc-50 hover:bg-zinc-50 transition">
                      <td className="px-5 py-3 font-medium text-zinc-800 max-w-[160px] truncate">{a.name}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-zinc-700">{a.total.toLocaleString("en-IN")}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-green-600 font-medium">{a.completed.toLocaleString("en-IN")}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-red-500 font-medium">{(a.total-a.completed).toLocaleString("en-IN")}</td>
                      <td className="px-5 py-3 text-right"><ScorePill score={a.avgScore} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : null}
    </div>
  );
          }
