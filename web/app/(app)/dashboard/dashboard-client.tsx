"use client";

import Link from "next/link";
import { motion } from "motion/react";
import AnimatedCounter from "@/components/animated-counter";
import DashboardFilters from "./dashboard-filters";
import AuditsDataTable, { type DataRow } from "./audits-data-table";
import { formatDuration, type RawParams } from "@/lib/audit-filters";

export default function DashboardClient({
  filtered = false,
  weekCount = 0,
  totalCount = 0,
  matchCount = 0,
  avgScore,
  avgDuration = null,
  recent,
  filters,
  agentOptions = [],
  error = null,
}: {
  filtered?: boolean;
  weekCount?: number;
  totalCount?: number;
  matchCount?: number;
  avgScore: number | null;
  avgDuration?: number | null;
  recent: DataRow[];
  filters: RawParams;
  agentOptions?: { id: string; name: string }[];
  error?: string | null;
}) {
  // Download reflects the current filter state — same params, server re-runs
  // the query over the full matching set (not just the rows shown here).
  const exportParams = new URLSearchParams(
    Object.entries(filters).filter(
      (e): e is [string, string] => typeof e[1] === "string" && e[1] !== "",
    ),
  ).toString();
  const exportHref = `/api/audits/export${
    exportParams ? `?${exportParams}` : ""
  }`;

  return (
    <div className="px-10 lg:px-16 py-14 max-w-6xl">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        className="mb-10"
      >
        <div className="text-xs uppercase tracking-[0.25em] text-[var(--sky-700)] font-semibold mb-3">
          Dashboard
        </div>
        <h1 className="font-display text-5xl md:text-6xl font-extrabold leading-[1.02] tracking-tight max-w-3xl">
          What your AI agents{" "}
          <span className="bg-gradient-to-r from-[var(--sky-700)] via-[var(--violet-500)] to-[var(--pink-500)] bg-clip-text text-transparent">
            have been up to.
          </span>
        </h1>
        <p className="text-zinc-500 mt-4 max-w-xl">
          {filtered
            ? "Showing audits that match your filters — cards and list reflect the filtered set."
            : totalCount > 0
            ? "Every call audited and scored, summarized below. Click any audit for the full breakdown."
            : "Run your first audit to start filling this dashboard."}
        </p>
        <Link
          href="/new-audit"
          className="inline-flex items-center gap-2 mt-6 rounded-full bg-[var(--ink)] text-white px-6 py-2.5 text-sm font-medium hover:bg-zinc-800 transition shadow-[0_8px_24px_-12px_rgba(15,23,42,0.4)]"
        >
          + New audit
        </Link>
      </motion.div>

      <DashboardFilters initial={filters} agentOptions={agentOptions} />

      {error && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 text-rose-700 text-sm px-5 py-3 mb-6">
          Couldn&apos;t apply filters: {error}
        </div>
      )}

      <motion.div
        initial="hidden"
        animate="visible"
        variants={{
          visible: { transition: { staggerChildren: 0.08 } },
        }}
        className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-16"
      >
        {filtered ? (
          <>
            <KpiCard index="01" label="Matching audits" value={matchCount} />
            <KpiCard
              index="02"
              label="Avg score"
              value={avgScore != null ? Math.round(avgScore * 20) : null}
              decimals={0}
              suffix={avgScore != null ? "%" : ""}
            />
            <KpiCard
              index="03"
              label="Avg duration"
              displayValue={
                avgDuration != null ? formatDuration(avgDuration) : "—"
              }
            />
          </>
        ) : (
          <>
            <KpiCard index="01" label="Audits this week" value={weekCount} />
            <KpiCard
              index="02"
              label="Avg score"
              value={avgScore}
              decimals={1}
              suffix={avgScore != null ? "/10" : ""}
            />
            <KpiCard index="03" label="All time" value={totalCount} />
          </>
        )}
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.2 }}
        className="flex items-end justify-between mb-5"
      >
        <div>
          <div className="text-xs uppercase tracking-[0.25em] text-[var(--sky-700)] font-semibold mb-1">
            {filtered ? "Results" : "Recent"}
          </div>
          <h2 className="font-display text-2xl font-bold">
            {filtered ? `Filtered audits (${recent.length})` : "Latest audits"}
          </h2>
        </div>
        <div className="flex items-center gap-4">
          {recent.length > 0 && (
            <a
              href={exportHref}
              className="inline-flex items-center gap-1.5 rounded-full bg-[var(--ink)] text-white px-4 py-2 text-sm font-medium hover:bg-zinc-800 transition shadow-[0_8px_24px_-12px_rgba(15,23,42,0.4)]"
            >
              <span aria-hidden>↓</span>
              Download Excel
            </a>
          )}
          <Link
            href="/audits"
            className="text-sm font-medium text-zinc-600 hover:text-[var(--ink)] transition"
          >
            View all &rarr;
          </Link>
        </div>
      </motion.div>

      {filtered && (
        <p className="text-xs text-zinc-500 mb-4">
          Excel includes the full filtered set
          {recent.length >= 50 ? "" : ` (${recent.length} rows)`}. The table
          below shows the first 50.
        </p>
      )}

      {recent.length > 0 ? (
        <AuditsDataTable rows={recent} />
      ) : (
        <EmptyState filtered={filtered} />
      )}

      <motion.section
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-80px" }}
        transition={{ duration: 0.7 }}
        className="mt-24"
      >
        <div className="text-xs uppercase tracking-[0.25em] text-[var(--sky-700)] font-semibold mb-3">
          How Otis works
        </div>
        <h2 className="font-display text-3xl md:text-4xl font-extrabold leading-tight mb-10 max-w-2xl">
          One call in. A full audit out.
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          <ProcessCard
            index="01"
            title="Listens."
            body="AssemblyAI transcribes with speaker diarization. Hindi, English, Hinglish, code-switched."
            tone="sky"
          />
          <ProcessCard
            index="02"
            title="Scores."
            body="Ten rubric dimensions, scored 1–5 with timestamped rationale per dimension."
            tone="violet"
          />
          <ProcessCard
            index="03"
            title="Coaches."
            body="Strengths, gaps, and concrete recommendations the AI team can ship next week."
            tone="pink"
          />
        </div>
      </motion.section>
    </div>
  );
}

function KpiCard({
  index,
  label,
  value,
  decimals = 0,
  suffix,
  displayValue,
}: {
  index: string;
  label: string;
  value?: number | null;
  decimals?: number;
  suffix?: string;
  displayValue?: string;
}) {
  return (
    <motion.div
      variants={{
        hidden: { opacity: 0, y: 16 },
        visible: { opacity: 1, y: 0 },
      }}
      transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
      whileHover={{ y: -4 }}
      className="relative rounded-3xl bg-[var(--paper)] p-7 group cursor-default"
    >
      <span className="absolute top-5 right-6 font-mono text-xs text-zinc-400">
        ({index})
      </span>
      <div className="text-[11px] uppercase tracking-[0.25em] text-zinc-500 font-medium">
        {label}
      </div>
      <div className="font-display text-5xl md:text-6xl font-extrabold mt-6 tabular-nums tracking-tight">
        {displayValue != null ? (
          displayValue
        ) : (
          <AnimatedCounter
            value={value ?? null}
            decimals={decimals}
            suffix={suffix}
          />
        )}
      </div>
    </motion.div>
  );
}

function ProcessCard({
  index,
  title,
  body,
  tone,
}: {
  index: string;
  title: string;
  body: string;
  tone: "sky" | "violet" | "pink";
}) {
  const accents: Record<typeof tone, string> = {
    sky: "from-[var(--sky-200)] to-[var(--sky-500)]",
    violet: "from-[var(--violet-200)] to-[var(--violet-500)]",
    pink: "from-[var(--pink-200)] to-[var(--pink-500)]",
  };
  return (
    <motion.div
      whileHover={{ y: -4 }}
      transition={{ duration: 0.25 }}
      className="relative rounded-3xl bg-[var(--paper)] p-7 overflow-hidden"
    >
      <span className="absolute top-5 right-6 font-mono text-xs text-zinc-400">
        ({index})
      </span>
      <div
        className={`w-12 h-12 rounded-2xl bg-gradient-to-br ${accents[tone]} mb-6`}
      />
      <div className="font-display text-2xl font-bold mb-2">{title}</div>
      <p className="text-sm text-zinc-600 leading-relaxed">{body}</p>
    </motion.div>
  );
}

function EmptyState({ filtered }: { filtered: boolean }) {
  return (
    <div className="rounded-3xl bg-[var(--paper)] p-12 text-center">
      <div className="text-sm text-zinc-500">
        {filtered
          ? "No audits match these filters. Try widening them or clear all."
          : "No audits yet. Run your first one and it'll show up here."}
      </div>
      {!filtered && (
        <Link
          href="/new-audit"
          className="inline-block mt-5 rounded-full bg-[var(--ink)] text-white px-6 py-2.5 text-sm font-medium hover:bg-zinc-800 transition"
        >
          + Run an audit
        </Link>
      )}
    </div>
  );
}
