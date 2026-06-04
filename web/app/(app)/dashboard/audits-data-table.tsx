"use client";

import { useState } from "react";
import Link from "next/link";
import { formatDuration } from "@/lib/audit-filters";
import {
  parseScores,
  parseRecommendations,
  type DimensionScore,
} from "@/lib/types/audit";

export type DataRow = {
  id: string;
  target: string;
  timestamp: string;
  audited_at: string | null;
  duration_seconds: number | null;
  overall_score: number | null;
  summary?: string | null;
  scores_json?: string | null;
  strengths?: string | null;
  what_was_lacking?: string | null;
  recommendations_json?: string | null;
  transcript?: string | null;
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

const COL_COUNT = 6;

export default function AuditsDataTable({ rows }: { rows: DataRow[] }) {
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <div className="rounded-3xl bg-[var(--paper)] overflow-x-auto">
      <table className="w-full text-sm min-w-[760px]">
        <thead>
          <tr className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">
            <Th className="w-8" />
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
            const au = fmt(row.audited_at ?? row.timestamp);
            const hasDur =
              row.duration_seconds != null && row.duration_seconds >= 0;
            const open = openId === row.id;
            return (
              <FragmentRow
                key={row.id}
                row={row}
                first={i === 0}
                open={open}
                onToggle={() => setOpenId(open ? null : row.id)}
                up={up}
                au={au}
                hasDur={hasDur}
              />
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function FragmentRow({
  row,
  first,
  open,
  onToggle,
  up,
  au,
  hasDur,
}: {
  row: DataRow;
  first: boolean;
  open: boolean;
  onToggle: () => void;
  up: { date: string; time: string };
  au: { date: string; time: string };
  hasDur: boolean;
}) {
  return (
    <>
      <tr
        onClick={onToggle}
        className={`group cursor-pointer hover:bg-white/60 transition ${
          first ? "" : "border-t border-white"
        } ${open ? "bg-white/60" : ""}`}
      >
        <Td className="text-zinc-400 text-center select-none">
          <span
            className={`inline-block transition-transform ${
              open ? "rotate-90" : ""
            }`}
          >
            ▸
          </span>
        </Td>
        <Td>
          <div className="font-medium truncate max-w-[320px] text-[var(--ink)]">
            {row.target}
          </div>
        </Td>
        <Td className="text-zinc-500 whitespace-nowrap">
          <div>{up.date}</div>
          <div className="text-zinc-400 text-[11px] mt-0.5">{up.time}</div>
        </Td>
        <Td className="text-zinc-500 whitespace-nowrap">
          <div>{au.date}</div>
          <div className="text-zinc-400 text-[11px] mt-0.5">{au.time}</div>
        </Td>
        <Td className="text-right tabular-nums whitespace-nowrap text-zinc-600">
          {hasDur ? formatDuration(row.duration_seconds) : "—"}
        </Td>
        <Td className="text-right pr-6">
          <ScorePill score={row.overall_score} />
        </Td>
      </tr>
      {open && (
        <tr className="border-t border-white">
          <td colSpan={COL_COUNT} className="px-6 py-5 bg-white/70">
            <AuditDetail row={row} />
          </td>
        </tr>
      )}
    </>
  );
}

function AuditDetail({ row }: { row: DataRow }) {
  const scores = parseScores(row.scores_json ?? null);
  const dims = Object.entries(scores);
  const recs = parseRecommendations(row.recommendations_json ?? null);

  return (
    <div className="space-y-5 max-w-4xl">
      {row.summary && (
        <Block title="Summary">
          <p className="text-sm text-zinc-700 leading-relaxed">{row.summary}</p>
        </Block>
      )}

      {dims.length > 0 && (
        <Block title="Dimensions">
          <div className="space-y-3">
            {dims.map(([key, val]) => (
              <Dimension key={key} dimKey={key} val={val} />
            ))}
          </div>
        </Block>
      )}

      {row.strengths && (
        <Block title="Strengths" tone="text-emerald-700">
          <p className="text-sm text-zinc-700 leading-relaxed whitespace-pre-line">
            {row.strengths}
          </p>
        </Block>
      )}

      {row.what_was_lacking && (
        <Block title="What was lacking" tone="text-rose-700">
          <p className="text-sm text-zinc-700 leading-relaxed whitespace-pre-line">
            {row.what_was_lacking}
          </p>
        </Block>
      )}

      {recs.length > 0 && (
        <Block title="Recommendations">
          <ol className="list-decimal pl-5 space-y-1">
            {recs.map((r, i) => (
              <li key={i} className="text-sm text-zinc-700 leading-relaxed">
                {r}
              </li>
            ))}
          </ol>
        </Block>
      )}

      {row.transcript && (
        <Block title="Transcript">
          <pre className="text-xs text-zinc-600 leading-relaxed whitespace-pre-wrap font-mono max-h-72 overflow-y-auto rounded-xl bg-[var(--paper)] p-4">
            {row.transcript}
          </pre>
        </Block>
      )}

      <Link
        href={`/audits/${row.id}`}
        className="inline-block text-sm font-medium text-[var(--sky-700)] hover:text-[var(--ink)] transition"
      >
        Open full audit &rarr;
      </Link>
    </div>
  );
}

function Dimension({
  dimKey,
  val,
}: {
  dimKey: string;
  val: DimensionScore | number;
}) {
  const isObj = typeof val !== "number";
  const score = isObj ? val.score : val;
  const rationale = isObj ? val.rationale : null;
  const max = isObj && typeof val.max === "number" ? val.max : 5;
  const label = isObj && val.name ? val.name : dimKey.replace(/_/g, " ");
  const frac = score == null || max <= 0 ? 0 : score / max;
  const tone =
    score == null
      ? "text-zinc-400"
      : frac >= 0.7
      ? "text-emerald-700"
      : frac >= 0.45
      ? "text-amber-700"
      : "text-rose-700";

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-medium capitalize text-[var(--ink)]">
          {label}
        </span>
        <span className={`text-sm font-semibold tabular-nums ${tone}`}>
          {score ?? "—"}
          <span className="text-zinc-400 font-normal"> / {max}</span>
        </span>
      </div>
      {rationale && (
        <p className="text-xs text-zinc-500 mt-0.5 leading-relaxed">
          {rationale}
        </p>
      )}
    </div>
  );
}

function Block({
  title,
  tone,
  children,
}: {
  title: string;
  tone?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div
        className={`text-[11px] uppercase tracking-[0.2em] font-semibold mb-2 ${
          tone ?? "text-zinc-500"
        }`}
      >
        {title}
      </div>
      {children}
    </div>
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
    <td className={`px-5 py-3 align-middle ${className ?? ""}`}>{children}</td>
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
