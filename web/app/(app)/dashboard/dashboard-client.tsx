"use client";

import Link from "next/link";
import { motion } from "motion/react";
import LottiePlayer from "@/components/lottie-player";
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
    <div className="px-10 py-12 max-w-6xl">
      <Hero hasAudits={totalCount > 0} />

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.2, ease: [0.22, 1, 0.36, 1] }}
        className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-14"
      >
        <KpiCard
          label="Audits this week"
          value={weekCount}
          accent="from-violet-400 to-fuchsia-400"
        />
        <KpiCard
          label="Avg score"
          value={avgScore}
          decimals={1}
          accent="from-cyan-300 to-emerald-300"
        />
        <KpiCard
          label="All time"
          value={totalCount}
          accent="from-amber-300 to-rose-300"
        />
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.35, ease: [0.22, 1, 0.36, 1] }}
        className="flex items-center justify-between mb-4"
      >
        <h2 className="text-lg font-medium">Recent audits</h2>
        <Link
          href="/audits"
          className="text-sm text-zinc-400 hover:text-white transition"
        >
          View all &rarr;
        </Link>
      </motion.div>

      {recent.length > 0 ? (
        <motion.div
          initial="hidden"
          animate="visible"
          variants={{
            visible: { transition: { staggerChildren: 0.05, delayChildren: 0.4 } },
          }}
          className="rounded-2xl border border-white/10 bg-zinc-900/40 backdrop-blur-md divide-y divide-white/5 overflow-hidden"
        >
          {recent.map((row) => (
            <motion.div
              key={row.id}
              variants={{
                hidden: { opacity: 0, y: 8 },
                visible: { opacity: 1, y: 0 },
              }}
              transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
            >
              <Link
                href={`/audits/${row.id}`}
                className="flex items-center justify-between px-5 py-4 hover:bg-white/5 transition group"
              >
                <div className="min-w-0 flex-1 mr-6">
                  <div className="text-sm font-medium truncate group-hover:text-white">
                    {row.target}
                  </div>
                  <div className="text-xs text-zinc-500 mt-0.5">
                    {new Date(row.timestamp).toLocaleString()}
                    {row.llm_provider && (
                      <> &middot; {row.llm_provider}</>
                    )}
                  </div>
                </div>
                <ScorePill score={row.overall_score} />
              </Link>
            </motion.div>
          ))}
        </motion.div>
      ) : null}
    </div>
  );
}

function Hero({ hasAudits }: { hasAudits: boolean }) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
      className="relative mb-12 rounded-3xl overflow-hidden border border-white/10 bg-gradient-to-br from-zinc-900/60 via-zinc-900/30 to-violet-900/20 backdrop-blur-xl"
    >
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(232,121,249,0.18),transparent_50%)] pointer-events-none" />

      <div className="relative flex flex-col md:flex-row items-center gap-6 md:gap-10 px-8 py-8">
        <motion.div
          initial={{ scale: 0.85, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.8, delay: 0.15, ease: [0.22, 1, 0.36, 1] }}
          className="shrink-0 w-48 h-48 md:w-56 md:h-56"
        >
          <LottiePlayer
            src="/lottie/hey.lottie"
            className="w-full h-full"
          />
        </motion.div>

        <div className="flex-1 text-center md:text-left">
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.6, delay: 0.3 }}
            className="text-xs uppercase tracking-[0.25em] text-cyan-300 mb-3"
          >
            Hi, I&apos;m Otis
          </motion.div>
          <motion.h1
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.6, delay: 0.4 }}
            className="text-3xl md:text-4xl font-semibold leading-tight"
          >
            {hasAudits ? (
              <>
                <span>Welcome back. </span>
                <span className="bg-gradient-to-r from-cyan-300 via-fuchsia-400 to-amber-300 bg-clip-text text-transparent">
                  Let&apos;s see how the agents did.
                </span>
              </>
            ) : (
              <>
                <span>I audit AI calls </span>
                <span className="bg-gradient-to-r from-cyan-300 via-fuchsia-400 to-amber-300 bg-clip-text text-transparent">
                  so you don&apos;t have to.
                </span>
              </>
            )}
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.6, delay: 0.5 }}
            className="text-zinc-400 mt-3 max-w-xl text-sm md:text-base"
          >
            Drop a recording, pick a preset, and I&apos;ll transcribe with
            speaker diarization, score every dimension, and surface what
            nailed it &mdash; or fumbled.
          </motion.p>
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.65 }}
            className="mt-6"
          >
            <Link
              href="/new-audit"
              className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 px-6 py-2.5 text-sm font-medium hover:opacity-90 hover:scale-[1.02] transition shadow-[0_0_40px_-10px_rgba(232,121,249,0.6)]"
            >
              {hasAudits ? "+ New audit" : "Run your first audit →"}
            </Link>
          </motion.div>
        </div>
      </div>
    </motion.section>
  );
}

function KpiCard({
  label,
  value,
  decimals = 0,
  accent,
}: {
  label: string;
  value: number | null;
  decimals?: number;
  accent: string;
}) {
  return (
    <motion.div
      whileHover={{ y: -4, scale: 1.01 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
      className="rounded-2xl border border-white/10 bg-zinc-900/40 backdrop-blur-md p-6 relative overflow-hidden group"
    >
      <div className="absolute inset-0 bg-gradient-to-br opacity-0 group-hover:opacity-10 transition-opacity pointer-events-none ${accent}" />
      <div className="text-xs uppercase tracking-widest text-zinc-500">
        {label}
      </div>
      <div className="text-4xl font-semibold mt-2 tabular-nums">
        <AnimatedCounter
          value={value}
          decimals={decimals}
          className={`bg-gradient-to-r ${accent} bg-clip-text text-transparent`}
        />
      </div>
    </motion.div>
  );
}

function ScorePill({ score }: { score: number | null }) {
  if (score == null) {
    return <span className="text-xs text-zinc-500">no score</span>;
  }
  const tone =
    score >= 7
      ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
      : score >= 5
      ? "bg-amber-500/15 text-amber-300 border-amber-500/30"
      : "bg-rose-500/15 text-rose-300 border-rose-500/30";
  return (
    <span
      className={`rounded-full border px-3 py-1 text-xs font-medium tabular-nums ${tone}`}
    >
      {score}/10
    </span>
  );
}
