"use client";

import { useState } from "react";
import Link from "next/link";
import { motion } from "motion/react";
import { formatDuration } from "@/lib/audit-filters";
import { istDateParts } from "@/lib/datetime";
import type { ReviewStatus } from "@/lib/types/audit";
import ReviewStatusControl from "../audits/review-status";

export type DataRow = {
  id: string;
  target: string;
  timestamp: string;
  audited_at: string | null;
  duration_seconds: number | null;
  overall_score: number | null;
  review_status?: ReviewStatus | null;
  preset?: string | null;
  llm_provider?: string | null;
  call_id?: string | null;
  mobile_number?: string | null;
  summary?: string | null;
  scores_json?: string | null;
  strengths?: string | null;
  what_was_lacking?: string | null;
  recommendations_json?: string | null;
  transcript?: string | null;
};

export default function AuditsDataTable({ rows }: { rows: DataRow[] }) {
  return (
    <motion.div
      initial="hidden"
      animate="visible"
      variants={{ visible: { transition: { staggerChildren: 0.03 } } }}
      className="rounded-3xl bg-[var(--paper)] overflow-x-auto"
    >
      <table className="w-full text-sm min-w-[800px]">
        <thead>
          <tr className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">
            <Th>When (IST)</Th>
            <Th>Recording</Th>
            <Th>Duration</Th>
            <Th>Preset</Th>
            <Th>LLM</Th>
            <Th>Review</Th>
            <Th className="text-right pr-6">Score</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const { date, time } = istDateParts(row.timestamp);
            const hasDur =
              row.duration_seconds != null && row.duration_seconds >= 0;
            const isUrl = /^https?:\/\//.test(row.target);
            return (
              <motion.tr
                key={row.id}
                variants={{ hidden: { opacity: 0, y: 6 }, visible: { opacity: 1, y: 0 } }}
                transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
                className={`group ${i !== 0 ? "border-t border-white" : ""}`}
              >
                <Td className="text-zinc-500 whitespace-nowrap">
                  <Link href={`/audits/${row.id}`} className="block py-1">
                    <div>{date}</div>
                    <div className="text-zinc-400 text-[11px] mt-0.5">{time}</div>
                  </Link>
                </Td>
                <Td>
                  <Link
                    href={`/audits/${row.id}`}
                    className="block py-1 group-hover:text-black transition"
                  >
                    <div className="font-medium text-[var(--ink)]">Recording</div>
                    {row.call_id && (
                      <div className="flex items-center gap-1 mt-0.5">
                        <span className="text-zinc-400 text-[11px] font-mono">
                          ID: {row.call_id}
                        </span>
                        <CopyButton value={row.call_id} />
                      </div>
                    )}
                    {row.summary && (
                      <div className="text-zinc-500 text-xs truncate max-w-sm mt-0.5">
                        {row.summary}
                      </div>
                    )}
                  </Link>
                  {isUrl && (
                    <audio
                      controls
                      className="w-full mt-1 max-w-xs"
                      src={row.target}
                      onClick={(e) => e.stopPropagation()}
                    />
                  )}
                </Td>
                <Td className="text-zinc-600 whitespace-nowrap tabular-nums">
                  <Link href={`/audits/${row.id}`} className="block py-1">
                    {hasDur ? formatDuration(row.duration_seconds) : "—"}
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
                <Td>
                  <ReviewStatusControl id={row.id} status={row.review_status} />
                </Td>
                <Td className="text-right pr-6">
                  <Link href={`/audits/${row.id}`} className="block py-1">
                    <Score score={row.overall_score} />
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

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <button
      onClick={handleCopy}
      title={copied ? "Copied!" : "Copy Call ID"}
      className="opacity-0 group-hover:opacity-100 transition-all text-zinc-400 hover:text-zinc-700 p-0.5 rounded"
    >
      {copied ? (
        <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-500">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      ) : (
        <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      )}
    </button>
  );
}

function Th({
  children,
  className,
}: {
  children?: React.ReactNode;
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
    <span className={`font-display font-extrabold tabular-nums text-2xl ${tone}`}>
      {pct}%
    </span>
  );
}
