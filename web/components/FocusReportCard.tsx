"use client";
// web/components/FocusReportCard.tsx
// Shows the Special Audit Focus Report at the top of a batch page.
// Renders nothing when the batch has no audit focus.

import { useCallback, useEffect, useState } from "react";
import { summarizeReasons, type FocusReport } from "@/lib/focus";

export default function FocusReportCard({ batchId }: { batchId: string }) {
  const [report, setReport] = useState<FocusReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openExamples, setOpenExamples] = useState<string | null>(null);

  const load = useCallback(
    async (force = false) => {
      if (force) setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/batches/${batchId}/focus-report`, {
          method: force ? "POST" : "GET",
          cache: "no-store",
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        setReport(data.report ?? null);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [batchId],
  );

  useEffect(() => {
    load(false);
  }, [load]);

  if (loading) {
    return (
      <div className="rounded-2xl border border-violet-200 bg-violet-50 p-5 text-sm text-violet-700">
        Building special audit report…
      </div>
    );
  }
  if (error) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-xs text-red-700">
        Special audit report failed: {error}
      </div>
    );
  }
  if (!report) return null;

  const maxCount = Math.max(1, ...report.reasons.map((r) => r.count));

  return (
    <section className="rounded-2xl border border-violet-200 bg-white shadow-sm overflow-hidden">
      <div className="bg-violet-700 px-5 py-4 text-white flex items-start justify-between gap-4">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-widest opacity-80">
            Special audit focus report
          </div>
          <h2 className="mt-1 text-base font-semibold">{report.question}</h2>
        </div>
        <button
          onClick={() => load(true)}
          disabled={refreshing}
          className="shrink-0 rounded-lg bg-white/15 px-3 py-1.5 text-xs font-medium hover:bg-white/25 disabled:opacity-50"
        >
          {refreshing ? "Refreshing…" : "Regenerate"}
        </button>
      </div>

      <div className="p-5 space-y-5">
        <div>
          <p className="text-[15px] font-semibold text-zinc-900">{report.headline}</p>
          {report.keyInsight && <p className="mt-1.5 text-sm text-zinc-600">{report.keyInsight}</p>}
          <p className="mt-2 text-xs text-zinc-400">
            Relevant calls: <b className="text-zinc-600">{report.applicableCalls}</b> of {report.totalCalls} audited
            {" · "}Not applicable: {report.notApplicableCalls}
            {report.lowConfidenceCalls > 0 && <> · Low-confidence: {report.lowConfidenceCalls}</>}
          </p>
        </div>

        <div className="overflow-hidden rounded-xl border border-zinc-200">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[#1b2a4a] text-left text-white">
                <th className="px-4 py-2.5 font-semibold">Reason</th>
                <th className="px-4 py-2.5 font-semibold w-24">Calls</th>
                <th className="px-4 py-2.5 font-semibold w-24">Share</th>
              </tr>
            </thead>
            <tbody>
              {summarizeReasons(report.reasons).map((row, i) => (
                <tr key={row.label} className={i % 2 ? "bg-white" : "bg-violet-50/60"}>
                  <td className={"px-4 py-2.5 " + (row.isOther ? "text-zinc-600" : "font-medium text-zinc-900")}>{row.label}</td>
                  <td className="px-4 py-2.5 tabular-nums">{row.count}</td>
                  <td className="px-4 py-2.5 tabular-nums font-semibold text-violet-700">{row.percent}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="text-xs font-semibold uppercase tracking-widest text-zinc-400">Details by reason</div>

        <div className="space-y-3">
          {report.reasons.map((r) => (
            <div key={r.category} className="rounded-xl border border-zinc-200 p-4">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-semibold text-zinc-900">{r.category}</span>
                <span className="text-xs text-zinc-500 whitespace-nowrap">
                  <b className="text-violet-700 text-sm">{r.percent}%</b> · {r.count} calls
                  {r.avgScore != null && <> · avg score {r.avgScore}</>}
                </span>
              </div>
              <div className="mt-2 h-2 rounded-full bg-zinc-100">
                <div className="h-2 rounded-full bg-violet-500" style={{ width: `${(r.count / maxCount) * 100}%` }} />
              </div>
              {r.rootCause && (
                <p className="mt-3 text-sm text-zinc-700">
                  <span className="font-semibold text-zinc-900">Why: </span>
                  {r.rootCause}
                </p>
              )}
              {r.fix && (
                <p className="mt-1 text-sm text-emerald-700">
                  <span className="font-semibold">Fix: </span>
                  {r.fix}
                </p>
              )}
              {r.examples.length > 0 && (
                <button
                  onClick={() => setOpenExamples(openExamples === r.category ? null : r.category)}
                  className="mt-2 text-xs font-medium text-violet-600 hover:underline"
                >
                  {openExamples === r.category ? "Hide" : "Show"} example calls ({r.examples.length})
                </button>
              )}
              {openExamples === r.category && (
                <ul className="mt-2 space-y-2">
                  {r.examples.map((e) => (
                    <li key={e.auditId} className="rounded-lg bg-zinc-50 p-3 text-xs text-zinc-700">
                      <a href={`/audits/${e.auditId}`} className="font-semibold text-violet-700 hover:underline">
                        {e.callId ? `Call ${e.callId}` : "Open audit"}
                      </a>
                      <span className="ml-1">— {e.finding}</span>
                      {e.evidence && <div className="mt-1 italic text-zinc-500">“{e.evidence}”</div>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>

        {report.recommendations.length > 0 && (
          <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-4">
            <div className="text-xs font-semibold uppercase tracking-widest text-emerald-700 mb-2">
              Recommended actions
            </div>
            <ol className="list-decimal pl-5 space-y-1 text-sm text-emerald-900">
              {report.recommendations.map((x, i) => (
                <li key={i}>{x}</li>
              ))}
            </ol>
          </div>
        )}

        {report.agents.length > 1 && (
          <div>
            <div className="text-xs font-semibold uppercase tracking-widest text-zinc-400 mb-2">By agent</div>
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-zinc-500">
                  <th className="py-1">Agent</th>
                  <th className="py-1">Relevant calls</th>
                  <th className="py-1">Top reason</th>
                </tr>
              </thead>
              <tbody>
                {report.agents.map((a) => (
                  <tr key={a.agentName} className="border-t border-zinc-100">
                    <td className="py-1.5 font-medium text-zinc-800">{a.agentName}</td>
                    <td className="py-1.5">{a.applicable}</td>
                    <td className="py-1.5">{a.topCategory}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
