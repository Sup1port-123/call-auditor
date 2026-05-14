"use client";

import Link from "next/link";
import { motion } from "motion/react";
import AnimatedCounter from "@/components/animated-counter";

type RecentRow = {
  id: string;
  timestamp: string;
  target: string;
  llm_provider: string | null;
  overall_score: number | null;
};

export default function DashboardClient({
  weekCount,
  totalCount,
  avgScore,
  recent,
}: {
  weekCount: number;
  totalCount: number;
  avgScore: number | null;
  recent: RecentRow[];
}) {
  return (
    <div className="px-10 lg:px-16 py-14 max-w-6xl">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        className="mb-12"
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
          {totalCount > 0
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

      <motion.div
        initial="hidden"
        animate="visible"
        variants={{
          visible: { transition: { staggerChildren: 0.08, delayChildren: 0.2 } },
        }}
        className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-16"
      >
        <KpiCard index="01" label="Audits this week" value={weekCount} />
        <KpiCard
          index="02"
          label="Avg score"
          value={avgScore}
          decimals={1}
          suffix={avgScore != null ? "/10" : ""}
        />
        <KpiCard index="03" label="All time" value={totalCount} />
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.4 }}
        className="flex items-end justify-between mb-5"
      >
        <div>
          <div className="text-xs uppercase tracking-[0.25em] text-[var(--sky-700)] font-semibold mb-1">
            Recent
          </div>
          <h2 className="font-display text-2xl font-bold">Latest audits</h2>
        </div>
        <Link
          href="/audits"
          className="text-sm font-medium text-zinc-600 hover:text-[var(--ink)] transition"
        >
          View all &rarr;
        </Link>
      </motion.div>

      {recent.length > 0 ? (
        <motion.div
          initial="hidden"
          animate="visible"
          variants={{
            visible: { transition: { staggerChildren: 0.04, delayChildren: 0.5 } },
          }}
          className="rounded-3xl bg-[var(--paper)] divide-y divide-white overflow-hidden"
        >
          {recent.map((row) => (
            <motion.div
              key={row.id}
              variants={{
                hidden: { opacity: 0, y: 8 },
                visible: { opacity: 1, y: 0 },
              }}
              transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
            >
              <Link
                href={`/audits/${row.id}`}
                className="flex items-center justify-between px-6 py-4 hover:bg-white transition group"
              >
                <div className="min-w-0 flex-1 mr-6">
                  <div className="text-[15px] font-medium truncate text-[var(--ink)] group-hover:text-black">
                    {row.target}
                  </div>
                  <div className="text-xs text-zinc-500 mt-1 flex items-center gap-2">
                    <span>{new Date(row.timestamp).toLocaleString()}</span>
                    {row.llm_provider && (
                      <>
                        <span className="text-zinc-300">·</span>
                        <span className="rounded-full bg-white px-2 py-0.5 text-[10px] uppercase tracking-widest text-zinc-500 border border-zinc-200">
                          {row.llm_provider}
                        </span>
                      </>
                    )}
                  </div>
                </div>
                <ScorePill score={row.overall_score} />
              </Link>
            </motion.div>
          ))}
        </motion.div>
      ) : (
        <EmptyState />
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
}: {
  index: string;
  label: string;
  value: number | null;
  decimals?: number;
  suffix?: string;
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
        <AnimatedCounter value={value} decimals={decimals} suffix={suffix} />
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

function ScorePill({ score }: { score: number | null }) {
  if (score == null) {
    return <span className="text-xs text-zinc-400">unscored</span>;
  }
  const tone =
    score >= 7
      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
      : score >= 5
      ? "bg-amber-50 text-amber-700 border-amber-200"
      : "bg-rose-50 text-rose-700 border-rose-200";
  return (
    <span
      className={`rounded-full border px-3 py-1.5 text-xs font-semibold tabular-nums ${tone}`}
    >
      {score}/10
    </span>
  );
}

function EmptyState() {
  return (
    <div className="rounded-3xl bg-[var(--paper)] p-12 text-center">
      <div className="text-sm text-zinc-500">
        No audits yet. Run your first one and it&apos;ll show up here.
      </div>
      <Link
        href="/new-audit"
        className="inline-block mt-5 rounded-full bg-[var(--ink)] text-white px-6 py-2.5 text-sm font-medium hover:bg-zinc-800 transition"
      >
        + Run an audit
      </Link>
    </div>
  );
}
