"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Batch } from "@/lib/types/batch";
import type { BatchAuditRow } from "./page";

type Counts = {
  queued: number;
  transcribing: number;
  scoring: number;
  completed: number;
  failed: number;
  total: number;
  done: boolean;
};

const ZERO: Counts = {
  queued: 0,
  transcribing: 0,
  scoring: 0,
  completed: 0,
  failed: 0,
  total: 0,
  done: false,
};

export default function BatchView({
  batch,
  agentName,
  audits,
}: {
  batch: Batch;
  agentName: string | null;
  audits: BatchAuditRow[];
}) {
  const router = useRouter();
  const [counts, setCounts] = useState<Counts>(() => tally(audits));
  const [runId, setRunId] = useState(0);
  const [retrying, setRetrying] = useState(false);

  // Filters
  const [filterCallId, setFilterCallId] = useState("");
  const [filterMobile, setFilterMobile] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");

  const filteredAudits = useMemo(() => {
    return audits.filter((a) => {
      if (
        filterCallId &&
        !a.call_id?.toLowerCase().includes(filterCallId.toLowerCase())
      )
        return false;
      if (
        filterMobile &&
        !a.mobile_number?.toLowerCase().includes(filterMobile.toLowerCase())
      )
        return false;
      if (filterStatus !== "all" && a.status !== filterStatus) return false;
      return true;
    });
  }, [audits, filterCallId, filterMobile, filterStatus]);

  const hasFilters =
    filterCallId !== "" || filterMobile !== "" || filterStatus !== "all";

  useEffect(() => {
    let cancelled = false;

    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const fetchStatus = async (): Promise<Counts> => {
      const res = await fetch(`/api/batches/${batch.id}/status`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error("status check failed");
      return (await res.json()) as Counts;
    };

    const drive = async () => {
      let guard = 0;
      while (!cancelled && guard < 5000) {
        guard++;
        let s: Counts;
        try {
          s = await fetchStatus();
        } catch {
          await sleep(3000);
          continue;
        }
        if (cancelled) return;
        setCounts(s);

        if (s.done) {
          router.refresh();
          break;
        }

        try {
          await fetch(`/api/batches/${batch.id}/process`, { method: "POST" });
        } catch {
          await sleep(3000);
        }
        router.refresh();
      }
    };

    drive();
    return () => {
      cancelled = true;
    };
  }, [batch.id, router, runId]);

  async function handleRetry() {
    if (retrying) return;
    setRetrying(true);
    try {
      await fetch(`/api/batches/${batch.id}/retry`, { method: "POST" });
      router.refresh();
      setCounts((c) => ({ ...c, done: false }));
      setRunId((n) => n + 1);
    } catch {
      // ignore
    } finally {
      setRetrying(false);
    }
  }

  useEffect(() => {
    setCounts((c) => ({ ...tally(audits), done: c.done }));
  }, [audits]);

  const submitting = counts.queued > 0;
  const inFlight = counts.transcribing > 0 || counts.scoring > 0;

  return (
    <div className="px-10 lg:px-16 py-14 max-w-5xl">
      <Link
        href="/batches"
        className="text-xs uppercase tracking-[0.25em] text-zinc-400 hover:text-zinc-600 transition inline-block mb-6"
      >
        &larr; All batches
      </Link>

      <div className="flex items-start justify-between gap-6 mb-2">
        <div>
          <div className="text-xs uppercase tracking-[0.25em] text-[var(--sky-700)] font-semibold mb-3">
            Batch
          </div>
          <h1 className="font-display text-3xl md:text-4xl font-extrabold tracking-tight break-all leading-[1.05]">
            {batch.label || "Untitled batch"}
          </h1>
          <div className="flex flex-wrap items-center gap-2 mt-4 text-xs text-zinc-500">
            <span className="rounded-full bg-[var(--paper)] px-3 py-1">
              {batch.total} recordings
            </span>
            {batch.url_column && (
              <span className="rounded-full bg-[var(--paper)] px-3 py-1">
                column: {batch.url_column}
              </span>
            )}
            {agentName && (
              <span className="rounded-full bg-gradient-to-r from-[var(--sky-200)] to-[var(--violet-200)] text-zinc-700 px-3 py-1 font-medium">
                {agentName}
              </span>
            )}
            {batch.preset && (
              <span className="rounded-full bg-[var(--paper)] px-3 py-1">
                {batch.preset}
              </span>
            )}
          </div>
        </div>
        <a
          href={`/api/batches/${batch.id}/export`}
          className="shrink-0 rounded-full bg-[var(--ink)] text-white px-5 py-2.5 text-sm font-medium hover:bg-zinc-800 transition"
        >
          Export CSV
        </a>
      </div>

      {/* progress */}
      <div className="rounded-3xl bg-[var(--paper)] p-6 my-10">
        <div className="flex items-center justify-between mb-3">
          <div className="text-sm font-medium">
            {counts.done
              ? "All done."
              : submitting
              ? "Queueing calls — keep this tab open…"
              : inFlight
              ? "Transcribing & scoring…"
              : "Starting…"}
          </div>
          <div className="text-sm tabular-nums text-zinc-500">
            {counts.completed + counts.failed} / {counts.total}
          </div>
        </div>
        <ProgressBar counts={counts} />
        <div className="flex flex-wrap items-center gap-2 mt-4">
          <Chip label="Queued" n={counts.queued} tone="zinc" />
          <Chip label="Transcribing" n={counts.transcribing} tone="sky" />
          <Chip label="Scoring" n={counts.scoring} tone="violet" />
          <Chip label="Completed" n={counts.completed} tone="emerald" />
          <Chip label="Failed" n={counts.failed} tone="rose" />
          {counts.failed > 0 && (
            <button
              type="button"
              onClick={handleRetry}
              disabled={retrying}
              className="ml-auto rounded-full bg-[var(--ink)] text-white px-4 py-1.5 text-xs font-medium hover:bg-zinc-800 transition disabled:opacity-50"
            >
              {retrying ? "Retrying…" : `Retry failed (${counts.failed})`}
            </button>
          )}
        </div>
        {counts.failed > 0 && !retrying && (
          <p className="text-xs text-zinc-500 mt-3">
            Re-runs only the failed recordings — already-transcribed ones are
            just re-scored. Keep this tab open while they process.
          </p>
        )}
      </div>

      {/* filters */}
      <div className="rounded-3xl bg-[var(--paper)] px-5 py-4 mb-3 flex flex-wrap items-center gap-3">
        <input
          type="text"
          placeholder="Search Call ID…"
          value={filterCallId}
          onChange={(e) => setFilterCallId(e.target.value)}
          className="rounded-full border border-zinc-200 bg-white px-4 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-zinc-300 w-40"
        />
        <input
          type="text"
          placeholder="Search Mobile…"
          value={filterMobile}
          onChange={(e) => setFilterMobile(e.target.value)}
          className="rounded-full border border-zinc-200 bg-white px-4 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-zinc-300 w-40"
        />
        <div className="flex flex-wrap gap-1.5">
          {["all", "completed", "failed", "queued", "transcribing", "scoring"].map(
            (s) => (
              <button
                key={s}
                onClick={() => setFilterStatus(s)}
                className={`rounded-full px-3 py-1 text-xs font-medium capitalize transition ${
                  filterStatus === s
                    ? "bg-zinc-800 text-white"
                    : "bg-white border border-zinc-200 text-zinc-600 hover:bg-zinc-50"
                }`}
              >
                {s === "all" ? "All" : s}
              </button>
            ),
          )}
        </div>
        {hasFilters && (
          <button
            onClick={() => {
              setFilterCallId("");
              setFilterMobile("");
              setFilterStatus("all");
            }}
            className="text-xs text-zinc-400 hover:text-zinc-600 transition"
          >
            ✕ Clear
          </button>
        )}
        <span className="ml-auto text-xs text-zinc-400 tabular-nums">
          {filteredAudits.length} / {audits.length}
        </span>
      </div>

      {/* rows */}
      <div className="rounded-3xl bg-[var(--paper)] overflow-hidden">
        {filteredAudits.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-zinc-400">
            No results match your filters.
          </div>
        ) : (
          filteredAudits.map((a, i) => (
            <Link
              key={a.id}
              href={`/audits/${a.id}`}
              className={`flex items-center gap-4 px-5 py-3 hover:bg-white transition ${
                i !== 0 ? "border-t border-white" : ""
              }`}
            >
              <StatusDot status={a.status} />
              <div className="min-w-0 flex-1">
                <div className="text-sm truncate text-[var(--ink)]">
                  {a.target}
                </div>
                <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                  {a.call_id && (
                    <span className="text-xs text-zinc-400">
                      ID:{" "}
                      <span className="text-zinc-600 font-medium">
                        {a.call_id}
                      </span>
                    </span>
                  )}
                  {a.mobile_number && (
                    <span className="text-xs text-zinc-400">
                      📞{" "}
                      <span className="text-zinc-600 font-medium">
                        {a.mobile_number}
                      </span>
                    </span>
                  )}
                </div>
                {a.status === "failed" && a.error_message && (
                  <div className="text-xs text-rose-600 truncate">
                    {a.error_message}
                  </div>
                )}
              </div>
              <div className="text-xs text-zinc-500 w-24 text-right shrink-0">
                {a.status ?? "—"}
              </div>
              <div className="w-10 text-right shrink-0">
                <Score score={a.overall_score} />
              </div>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}

function tally(audits: BatchAuditRow[]): Counts {
  const c: Counts = { ...ZERO, total: audits.length };
  for (const a of audits) {
    const s = a.status as keyof Counts;
    if (s === "queued") c.queued++;
    else if (s === "transcribing") c.transcribing++;
    else if (s === "scoring") c.scoring++;
    else if (s === "completed") c.completed++;
    else if (s === "failed") c.failed++;
  }
  c.done =
    c.total > 0 && c.queued === 0 && c.transcribing === 0 && c.scoring === 0;
  return c;
}

function ProgressBar({ counts }: { counts: Counts }) {
  const t = Math.max(1, counts.total);
  const seg = (n: number) => `${(n / t) * 100}%`;
  return (
    <div className="h-3 rounded-full bg-white overflow-hidden flex">
      <div className="bg-emerald-400" style={{ width: seg(counts.completed) }} />
      <div className="bg-rose-400" style={{ width: seg(counts.failed) }} />
      <div className="bg-violet-400" style={{ width: seg(counts.scoring) }} />
      <div className="bg-sky-400" style={{ width: seg(counts.transcribing) }} />
    </div>
  );
}

function Chip({
  label,
  n,
  tone,
}: {
  label: string;
  n: number;
  tone: "zinc" | "sky" | "violet" | "emerald" | "rose";
}) {
  const tones: Record<typeof tone, string> = {
    zinc: "bg-white text-zinc-600 border-zinc-200",
    sky: "bg-sky-50 text-sky-700 border-sky-200",
    violet: "bg-violet-50 text-violet-700 border-violet-200",
    emerald: "bg-emerald-50 text-emerald-700 border-emerald-200",
    rose: "bg-rose-50 text-rose-700 border-rose-200",
  };
  return (
    <span
      className={`rounded-full border px-3 py-1 text-xs font-medium tabular-nums ${tones[tone]}`}
    >
      {label} {n}
    </span>
  );
}

function StatusDot({ status }: { status: string | null }) {
  const tone =
    status === "completed"
      ? "bg-emerald-500"
      : status === "failed"
      ? "bg-rose-500"
      : status === "scoring"
      ? "bg-violet-500"
      : status === "transcribing"
      ? "bg-sky-500"
      : "bg-zinc-300";
  return <span className={`w-2 h-2 rounded-full shrink-0 ${tone}`} />;
}

function Score({ score }: { score: number | null }) {
  if (score == null) return <span className="text-xs text-zinc-400">—</span>;
  const pct = Math.round(score * 20);
  const tone =
    pct >= 70
      ? "text-emerald-600"
      : pct >= 50
      ? "text-amber-600"
      : "text-rose-600";
  return (
    <span className={`font-display font-extrabold tabular-nums ${tone}`}>
      {pct}%
    </span>
  );
}
