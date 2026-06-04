"use client";

import Link from "next/link";
import { motion } from "motion/react";
import { formatDuration } from "@/lib/audit-filters";

export type DataRow = {
  id: string;
  target: string;
  timestamp: string;
  audited_at: string | null;
  duration_seconds: number | null;
  overall_score: number | null;
};

function fmt(iso: string | null): { date: string; time: string } {
  if (!iso) return { date: "—", time: "" };
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { date: "—", time: "" };
  return {
    date: d.toLocaleDateString(),
    time: d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
  };
}

export default function AuditsDataTable({ rows }: { rows: DataRow[] }) {
  return (
    <motion.div
      initial="hidden"
      animate="visible"
      variants={{ visible: { transition: { staggerChildren: 0.02 } } }}
      className="rounded-3xl bg-[var(--paper)] overflow-x-auto"
    >
      <table className="w-full text-sm min-w-[720px]">
        <thead>
          <tr className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">
            <Th>Recording</Th>
            <Th>Uploaded</Th>
            <Th>Audited</Th>
            <Th className="text-right">Duration</Th>
            <Th className="text-right pr-6">Score</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const up = fmt(row.timestamp);
            // Old audits have no audited_at — fall back to the upload time.
            const au = fmt(row.audited_at ?? row.timestamp);
            const hasDur =
              row.duration_seconds != null && row.duration_seconds >= 0;
            return (
              <motion.tr
                key={row.id}
                variants={{
                  hidden: { opacity: 0, y: 6 },
                  visible: { opacity: 1, y: 0 },
                }}
                transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                className={`group ${i !== 0 ? "border-t border-white" : ""}`}
              >
                <Td>
                  <Link
                    href={`/audits/${row.id}`}
                    className="block py-1 group-hover:text-black transition"
                  >
                    <div className="font-medium truncate max-w-[340px] text-[var(--ink)]">
                      {row.target}
                    </div>
                  </Link>
                </Td>
                <Td className="text-zinc-500 whitespace-nowrap">
                  <Link href={`/audits/${row.id}`} className="block py-1">
                    <div>{up.date}</div>
                    <div className="text-zinc-400 text-[11px] mt-0.5">
                      {up.time}
                    </div>
                  </Link>
                </Td>
                <Td className="text-zinc-500 whitespace-nowrap">
                  <Link href={`/audits/${row.id}`} className="block py-1">
                    <div>{au.date}</div>
                    <div className="text-zinc-400 text-[11px] mt-0.5">
                      {au.time}
                    </div>
                  </Link>
                </Td>
                <Td className="text-right tabular-nums whitespace-nowrap text-zinc-600">
                  <Link href={`/audits/${row.id}`} className="block py-1">
                    {hasDur ? formatDuration(row.duration_seconds) : "—"}
                  </Link>
                </Td>
                <Td className="text-right pr-6">
                  <Link href={`/audits/${row.id}`} className="block py-1">
                    <ScorePill score={row.overall_score} />
                  </Link>
                </Td>
              </motion.tr>
            );
          })}
        </tbody>
      </table>
    </motion.div>
  );
}

function Th({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <th className={`text-left font-medium px-5 py-4 ${className ?? ""}`}>
      {children}
    </th>
  );
}

function Td({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <td className={`px-5 py-2 align-middle ${className ?? ""}`}>{children}</td>
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
