"use client";

import Link from "next/link";
import { motion } from "motion/react";

type Row = {
  id: string;
  timestamp: string;
  target: string;
  preset: string | null;
  llm_provider: string | null;
  overall_score: number | null;
  summary: string | null;
};

export default function AuditsTable({ rows }: { rows: Row[] }) {
  return (
    <motion.div
      initial="hidden"
      animate="visible"
      variants={{
        visible: { transition: { staggerChildren: 0.03 } },
      }}
      className="rounded-3xl bg-[var(--paper)] overflow-hidden"
    >
      <table className="w-full text-sm">
        <thead>
          <tr className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">
            <Th>When</Th>
            <Th>Target</Th>
            <Th>Preset</Th>
            <Th>LLM</Th>
            <Th className="text-right pr-6">Score</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <motion.tr
              key={row.id}
              variants={{
                hidden: { opacity: 0, y: 6 },
                visible: { opacity: 1, y: 0 },
              }}
              transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
              className={`group ${i !== 0 ? "border-t border-white" : ""}`}
            >
              <Td className="text-zinc-500 whitespace-nowrap">
                <Link href={`/audits/${row.id}`} className="block py-1">
                  <div>{new Date(row.timestamp).toLocaleDateString()}</div>
                  <div className="text-zinc-400 text-[11px] mt-0.5">
                    {new Date(row.timestamp).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </div>
                </Link>
              </Td>
              <Td>
                <Link
                  href={`/audits/${row.id}`}
                  className="block py-1 group-hover:text-black transition"
                >
                  <div className="font-medium truncate max-w-sm text-[var(--ink)]">
                    {row.target}
                  </div>
                  {row.summary && (
                    <div className="text-zinc-500 text-xs truncate max-w-sm mt-0.5">
                      {row.summary}
                    </div>
                  )}
                </Link>
              </Td>
              <Td className="text-zinc-600">
                <Link href={`/audits/${row.id}`} className="block py-1">
                  {row.preset ? (
                    <span className="rounded-full bg-white px-3 py-1 text-[11px] font-medium border border-zinc-200">
                      {row.preset}
                    </span>
                  ) : (
                    "—"
                  )}
                </Link>
              </Td>
              <Td className="text-zinc-600">
                <Link href={`/audits/${row.id}`} className="block py-1">
                  {row.llm_provider ? (
                    <span className="rounded-full bg-white px-3 py-1 text-[11px] font-medium border border-zinc-200">
                      {row.llm_provider}
                    </span>
                  ) : (
                    "—"
                  )}
                </Link>
              </Td>
              <Td className="text-right pr-6">
                <Link href={`/audits/${row.id}`} className="block py-1">
                  <Score score={row.overall_score} />
                </Link>
              </Td>
            </motion.tr>
          ))}
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
    <th
      className={`text-left font-medium px-5 py-4 ${className ?? ""}`}
    >
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

function Score({ score }: { score: number | null }) {
  if (score == null) return <span className="text-xs text-zinc-400">—</span>;
  const tone =
    score >= 7
      ? "text-emerald-600"
      : score >= 5
      ? "text-amber-600"
      : "text-rose-600";
  return (
    <span
      className={`font-display font-extrabold tabular-nums text-2xl ${tone}`}
    >
      {score}
    </span>
  );
}
