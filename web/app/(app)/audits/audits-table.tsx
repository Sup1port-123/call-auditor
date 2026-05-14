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
        visible: { transition: { staggerChildren: 0.035 } },
      }}
      className="rounded-2xl border border-white/10 bg-zinc-900/40 backdrop-blur-md overflow-hidden"
    >
      <table className="w-full text-sm">
        <thead className="bg-white/[0.03] text-zinc-400">
          <tr>
            <Th>When</Th>
            <Th>Target</Th>
            <Th>Preset</Th>
            <Th>LLM</Th>
            <Th className="text-right pr-6">Score</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5">
          {rows.map((row) => (
            <motion.tr
              key={row.id}
              variants={{
                hidden: { opacity: 0, y: 6 },
                visible: { opacity: 1, y: 0 },
              }}
              transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
              whileHover={{
                backgroundColor: "rgba(255,255,255,0.04)",
              }}
              className="cursor-pointer"
            >
              <Td className="text-zinc-400 whitespace-nowrap">
                <Link href={`/audits/${row.id}`} className="block">
                  {new Date(row.timestamp).toLocaleDateString()}{" "}
                  <span className="text-zinc-600">
                    {new Date(row.timestamp).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </Link>
              </Td>
              <Td>
                <Link href={`/audits/${row.id}`} className="block">
                  <div className="font-medium truncate max-w-xs">
                    {row.target}
                  </div>
                  {row.summary && (
                    <div className="text-zinc-500 text-xs truncate max-w-xs">
                      {row.summary}
                    </div>
                  )}
                </Link>
              </Td>
              <Td className="text-zinc-400">
                <Link href={`/audits/${row.id}`} className="block">
                  {row.preset || "—"}
                </Link>
              </Td>
              <Td className="text-zinc-400">
                <Link href={`/audits/${row.id}`} className="block">
                  {row.llm_provider || "—"}
                </Link>
              </Td>
              <Td className="text-right pr-6">
                <Link href={`/audits/${row.id}`} className="block">
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
      className={`text-left font-medium text-xs uppercase tracking-widest px-4 py-3 ${className ?? ""}`}
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
  return <td className={`px-4 py-3 ${className ?? ""}`}>{children}</td>;
}

function Score({ score }: { score: number | null }) {
  if (score == null) return <span className="text-xs text-zinc-500">—</span>;
  const tone =
    score >= 7
      ? "text-emerald-300"
      : score >= 5
      ? "text-amber-300"
      : "text-rose-300";
  return (
    <span className={`font-semibold tabular-nums text-base ${tone}`}>
      {score}
    </span>
  );
}
