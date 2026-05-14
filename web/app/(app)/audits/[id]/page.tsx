import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  parseScores,
  parseRecommendations,
  type Audit,
  type DimensionScore,
} from "@/lib/types/audit";
import AuditPoller from "./audit-poller";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type AuditRow = Audit & {
  status?: string;
  error_message?: string | null;
};

export default async function AuditDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: audit, error } = await supabase
    .from("audits")
    .select("*")
    .eq("id", id)
    .maybeSingle<AuditRow>();

  if (error || !audit) {
    notFound();
  }

  const pending = audit.status && audit.status !== "completed";

  if (pending) {
    return (
      <div className="px-10 py-12 max-w-3xl">
        <Link
          href="/audits"
          className="text-xs text-zinc-500 hover:text-zinc-300 transition inline-block mb-6"
        >
          &larr; All audits
        </Link>
        <h1 className="text-2xl font-semibold break-all mb-8">
          {audit.target}
        </h1>
        <AuditPoller
          id={audit.id}
          initialStatus={
            (audit.status as
              | "transcribing"
              | "scoring"
              | "completed"
              | "failed") ?? "transcribing"
          }
          initialError={audit.error_message ?? null}
        />
      </div>
    );
  }

  const scores = parseScores(audit.scores_json);
  const recommendations = parseRecommendations(audit.recommendations_json);

  return (
    <div className="px-10 py-12 max-w-5xl">
      <Link
        href="/audits"
        className="text-xs text-zinc-500 hover:text-zinc-300 transition inline-block mb-6"
      >
        &larr; All audits
      </Link>

      <div className="flex items-start justify-between gap-6 mb-2">
        <h1 className="text-2xl font-semibold break-all bg-gradient-to-r from-white to-zinc-400 bg-clip-text text-transparent">
          {audit.target}
        </h1>
        <OverallScore score={audit.overall_score} />
      </div>
      <div className="text-xs text-zinc-500 mb-10">
        {new Date(audit.timestamp).toLocaleString()}
        {audit.llm_provider && <> &middot; scored by {audit.llm_provider}</>}
        {audit.preset && <> &middot; preset: {audit.preset}</>}
        {audit.strictness && <> &middot; strictness: {audit.strictness}</>}
      </div>

      {audit.summary && (
        <Section title="Summary">
          <p className="text-zinc-200 leading-relaxed">{audit.summary}</p>
        </Section>
      )}

      {Object.keys(scores).length > 0 && (
        <Section title="Dimension scores">
          <div className="space-y-3">
            {Object.entries(scores).map(([dim, val]) => (
              <DimensionRow key={dim} name={dim} value={val} />
            ))}
          </div>
        </Section>
      )}

      {audit.strengths && (
        <Section title="Strengths" tone="emerald">
          <p className="text-zinc-200 leading-relaxed whitespace-pre-line">
            {audit.strengths}
          </p>
        </Section>
      )}

      {audit.what_was_lacking && (
        <Section title="What was lacking" tone="rose">
          <p className="text-zinc-200 leading-relaxed whitespace-pre-line">
            {audit.what_was_lacking}
          </p>
        </Section>
      )}

      {recommendations.length > 0 && (
        <Section title="Recommendations">
          <ul className="space-y-2">
            {recommendations.map((r, i) => (
              <li
                key={i}
                className="flex gap-3 text-zinc-200 leading-relaxed"
              >
                <span className="text-fuchsia-400 mt-1.5 shrink-0">●</span>
                <span>{r}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {audit.transcript && (
        <Section title="Transcript">
          <pre className="text-zinc-300 text-sm leading-relaxed whitespace-pre-wrap font-sans">
            {audit.transcript}
          </pre>
        </Section>
      )}
    </div>
  );
}

function OverallScore({ score }: { score: number | null }) {
  if (score == null) {
    return (
      <div className="text-xs text-zinc-500 whitespace-nowrap pt-2">
        unscored
      </div>
    );
  }
  const tone =
    score >= 7
      ? "from-emerald-400 to-cyan-400"
      : score >= 5
      ? "from-amber-400 to-orange-400"
      : "from-rose-400 to-fuchsia-400";
  return (
    <div className="text-right shrink-0 score-pulse rounded-2xl px-5 py-3">
      <div
        className={`text-6xl font-bold tabular-nums bg-gradient-to-br ${tone} bg-clip-text text-transparent leading-none`}
      >
        {score}
      </div>
      <div className="text-xs text-zinc-500 mt-1">/ 10 overall</div>
    </div>
  );
}

function Section({
  title,
  children,
  tone,
}: {
  title: string;
  children: React.ReactNode;
  tone?: "emerald" | "rose";
}) {
  const accent =
    tone === "emerald"
      ? "text-emerald-300"
      : tone === "rose"
      ? "text-rose-300"
      : "text-zinc-200";
  return (
    <section className="mb-10">
      <h2
        className={`text-xs uppercase tracking-widest mb-3 font-medium ${accent}`}
      >
        {title}
      </h2>
      <div className="rounded-2xl border border-white/10 bg-zinc-900/40 backdrop-blur-md p-6">
        {children}
      </div>
    </section>
  );
}

function DimensionRow({
  name,
  value,
}: {
  name: string;
  value: DimensionScore | number;
}) {
  const score = typeof value === "number" ? value : value.score;
  const rationale = typeof value === "number" ? null : value.rationale;
  const pct = Math.max(0, Math.min(100, (score / 10) * 100));
  const tone =
    score >= 7
      ? "bg-emerald-500"
      : score >= 5
      ? "bg-amber-500"
      : "bg-rose-500";

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <div className="text-sm capitalize">{name.replace(/_/g, " ")}</div>
        <div className="text-sm font-medium tabular-nums">{score}</div>
      </div>
      <div className="h-2 rounded-full bg-zinc-800 overflow-hidden">
        <div className={`h-full ${tone}`} style={{ width: `${pct}%` }} />
      </div>
      {rationale && (
        <p className="text-xs text-zinc-500 mt-1.5 leading-relaxed">
          {rationale}
        </p>
      )}
    </div>
  );
}
