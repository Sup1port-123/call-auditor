import Link from "next/link";
import { notFound } from "next/navigation";
import ReviewStatusControl from "../review-status";
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
  agent_id?: string | null;
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

  let agent: { id: string; name: string } | null = null;
  if (audit.agent_id) {
    const { data } = await supabase
      .from("agents")
      .select("id, name")
      .eq("id", audit.agent_id)
      .maybeSingle();
    agent = data;
  }

  const pending = audit.status && audit.status !== "completed";

  if (pending) {
    return (
      <div className="px-10 lg:px-16 py-14 max-w-3xl">
        <Link
          href="/audits"
          className="text-xs uppercase tracking-[0.25em] text-zinc-400 hover:text-zinc-600 transition inline-block mb-6"
        >
          &larr; All audits
        </Link>
        <h1 className="font-display text-3xl font-bold break-all mb-10">
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

  let sectionIndex = 1;
  const nextIndex = () => String(sectionIndex++).padStart(2, "0");

  return (
    <div className="px-10 lg:px-16 py-14 max-w-5xl">
      <Link
        href="/audits"
        className="text-xs uppercase tracking-[0.25em] text-zinc-400 hover:text-zinc-600 transition inline-block mb-6"
      >
        &larr; All audits
      </Link>

      <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-8 items-end mb-12">
        <div>
          <div className="text-xs uppercase tracking-[0.25em] text-[var(--sky-700)] font-semibold mb-3">
            Audit
          </div>
          <h1 className="font-display text-3xl md:text-4xl font-extrabold tracking-tight break-all leading-[1.05]">
            {audit.target}
          </h1>
          <div className="flex flex-wrap items-center gap-2 mt-4 text-xs text-zinc-500">
            <span className="rounded-full bg-[var(--paper)] px-3 py-1">
              {new Date(audit.timestamp).toLocaleString()}
            </span>
            {agent && (
              <Link
                href={`/agents/${agent.id}`}
                className="rounded-full bg-gradient-to-r from-[var(--sky-200)] to-[var(--violet-200)] text-zinc-700 px-3 py-1 font-medium hover:opacity-80 transition"
              >
                {agent.name}
              </Link>
            )}
            {audit.llm_provider && (
              <span className="rounded-full bg-[var(--paper)] px-3 py-1">
                {audit.llm_provider}
              </span>
            )}
            {audit.preset && (
              <span className="rounded-full bg-[var(--paper)] px-3 py-1">
                preset: {audit.preset}
              </span>
            )}
            {audit.strictness && (
              <span className="rounded-full bg-[var(--paper)] px-3 py-1">
                {audit.strictness}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 mt-4">
            <span className="text-[11px] uppercase tracking-[0.2em] text-zinc-400">
              Review
            </span>
            <ReviewStatusControl
              id={audit.id}
              status={audit.review_status}
              refresh
            />
          </div>
        </div>
        <OverallScore score={audit.overall_score} />
      </div>

      {audit.summary && (
        <Section index={nextIndex()} title="Summary">
          <p className="text-zinc-700 leading-relaxed text-[15px]">
            {audit.summary}
          </p>
        </Section>
      )}

      {Object.keys(scores).length > 0 && (
        <Section index={nextIndex()} title="Dimensions">
          <div className="space-y-5">
            {Object.entries(scores).map(([dim, val]) => (
              <DimensionRow key={dim} name={dim} value={val} />
            ))}
          </div>
        </Section>
      )}

      {audit.strengths && (
        <Section index={nextIndex()} title="Strengths" tone="emerald">
          <p className="text-zinc-700 leading-relaxed whitespace-pre-line text-[15px]">
            {audit.strengths}
          </p>
        </Section>
      )}

      {audit.what_was_lacking && (
        <Section index={nextIndex()} title="What was lacking" tone="rose">
          <p className="text-zinc-700 leading-relaxed whitespace-pre-line text-[15px]">
            {audit.what_was_lacking}
          </p>
        </Section>
      )}

      {recommendations.length > 0 && (
        <Section index={nextIndex()} title="Recommendations">
          <ul className="space-y-3">
            {recommendations.map((r, i) => (
              <li key={i} className="flex gap-3 text-zinc-700 leading-relaxed">
                <span className="rounded-full w-6 h-6 shrink-0 bg-gradient-to-br from-[var(--violet-200)] to-[var(--pink-200)] text-zinc-700 text-xs font-bold flex items-center justify-center mt-0.5">
                  {i + 1}
                </span>
                <span className="text-[15px]">{r}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {audit.transcript && (
        <Section index={nextIndex()} title="Transcript">
          <pre className="text-zinc-700 text-sm leading-relaxed whitespace-pre-wrap font-mono">
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
      <div className="text-xs text-zinc-400 uppercase tracking-widest">
        unscored
      </div>
    );
  }
  const tone =
    score >= 7
      ? "from-emerald-400 to-cyan-400"
      : score >= 5
      ? "from-amber-400 to-orange-400"
      : "from-rose-400 to-pink-400";
  return (
    <div className="text-right shrink-0">
      <div className="text-xs uppercase tracking-[0.25em] text-zinc-500 mb-2">
        Overall
      </div>
      <div
        className={`font-display text-[7rem] md:text-[8rem] font-black leading-none tabular-nums bg-gradient-to-br ${tone} bg-clip-text text-transparent`}
      >
        {score}
      </div>
      <div className="text-xs text-zinc-500 mt-1 font-mono">/ 10</div>
    </div>
  );
}

function Section({
  index,
  title,
  children,
  tone,
}: {
  index: string;
  title: string;
  children: React.ReactNode;
  tone?: "emerald" | "rose";
}) {
  const accent =
    tone === "emerald"
      ? "text-emerald-600"
      : tone === "rose"
      ? "text-rose-600"
      : "text-[var(--ink)]";
  return (
    <section className="mb-6">
      <div className="rounded-3xl bg-[var(--paper)] p-7 relative">
        <span className="absolute top-5 right-6 font-mono text-xs text-zinc-400">
          ({index})
        </span>
        <div className={`font-display text-xl font-bold mb-4 ${accent}`}>
          {title}
        </div>
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
  const isObj = typeof value !== "number";
  const score = isObj ? value.score : value;
  const rationale = isObj ? value.rationale : null;
  // Newer audits snapshot the rubric range; legacy ones default to 1–5.
  const max = isObj && typeof value.max === "number" ? value.max : 5;
  const label = isObj && value.name ? value.name : name.replace(/_/g, " ");

  // Bar fills to score/max; tone keys off that fraction, not an absolute
  // threshold, so it works for any custom range.
  const frac = score == null || max <= 0 ? 0 : score / max;
  const pct = Math.max(0, Math.min(100, frac * 100));
  const tone =
    score == null
      ? "bg-zinc-300"
      : frac >= 0.7
      ? "bg-gradient-to-r from-emerald-300 to-cyan-300"
      : frac >= 0.45
      ? "bg-gradient-to-r from-amber-300 to-orange-300"
      : "bg-gradient-to-r from-rose-300 to-pink-300";

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <div className="text-sm font-medium capitalize text-[var(--ink)]">
          {label}
        </div>
        <div className="text-sm font-semibold tabular-nums text-zinc-700">
          {score ?? "—"}
          <span className="text-zinc-400 font-normal"> / {max}</span>
        </div>
      </div>
      <div className="h-2 rounded-full bg-white overflow-hidden">
        <div className={`h-full ${tone}`} style={{ width: `${pct}%` }} />
      </div>
      {rationale && (
        <p className="text-xs text-zinc-500 mt-2 leading-relaxed">
          {rationale}
        </p>
      )}
    </div>
  );
}
