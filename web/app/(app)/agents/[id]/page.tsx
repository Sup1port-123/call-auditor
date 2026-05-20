import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Agent } from "@/lib/types/agent";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function AgentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: agent, error } = await supabase
    .from("agents")
    .select("*")
    .eq("id", id)
    .maybeSingle<Agent>();

  if (error || !agent) {
    notFound();
  }

  const { data: audits } = await supabase
    .from("audits")
    .select("id, timestamp, target, overall_score")
    .eq("agent_id", id)
    .order("timestamp", { ascending: false })
    .limit(20);

  const kb = agent.knowledge_base ?? "";

  return (
    <div className="px-10 lg:px-16 py-14 max-w-5xl">
      <Link
        href="/agents"
        className="text-xs uppercase tracking-[0.25em] text-zinc-400 hover:text-zinc-600 transition inline-block mb-6"
      >
        &larr; All agents
      </Link>

      <div className="flex items-start gap-5 mb-10">
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-[var(--sky-200)] to-[var(--violet-500)] shrink-0" />
        <div>
          <div className="text-xs uppercase tracking-[0.25em] text-[var(--sky-700)] font-semibold mb-2">
            Agent
          </div>
          <h1 className="font-display text-4xl font-extrabold tracking-tight leading-none">
            {agent.name}
          </h1>
          {agent.target && (
            <p className="text-zinc-600 mt-2 max-w-xl">{agent.target}</p>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-3 mb-10">
        <Link
          href={`/new-audit?agent=${agent.id}`}
          className="rounded-full bg-[var(--ink)] text-white px-5 py-2 text-sm font-medium hover:bg-zinc-800 transition"
        >
          + Audit a call for this agent
        </Link>
      </div>

      <Section index="01" title="Knowledge base">
        {kb ? (
          <>
            <p className="text-xs text-zinc-500 mb-3">
              {kb.length.toLocaleString()} characters · injected into the
              scoring prompt for every audit tied to this agent.
            </p>
            <pre className="text-zinc-700 text-sm leading-relaxed whitespace-pre-wrap font-mono max-h-[480px] overflow-y-auto rounded-xl bg-white p-4">
              {kb}
            </pre>
          </>
        ) : (
          <p className="text-sm text-zinc-500">
            No knowledge base attached.
          </p>
        )}
      </Section>

      <Section index="02" title={`Audits (${audits?.length ?? 0})`}>
        {audits && audits.length > 0 ? (
          <div className="divide-y divide-white">
            {audits.map((a) => (
              <Link
                key={a.id}
                href={`/audits/${a.id}`}
                className="flex items-center justify-between py-3 hover:opacity-70 transition"
              >
                <div className="min-w-0 flex-1 mr-4">
                  <div className="text-sm font-medium truncate">
                    {a.target}
                  </div>
                  <div className="text-xs text-zinc-500 mt-0.5">
                    {new Date(a.timestamp).toLocaleString()}
                  </div>
                </div>
                <Score score={a.overall_score} />
              </Link>
            ))}
          </div>
        ) : (
          <p className="text-sm text-zinc-500">
            No audits run for this agent yet.
          </p>
        )}
      </Section>
    </div>
  );
}

function Section({
  index,
  title,
  children,
}: {
  index: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-6">
      <div className="rounded-3xl bg-[var(--paper)] p-7 relative">
        <span className="absolute top-5 right-6 font-mono text-xs text-zinc-400">
          ({index})
        </span>
        <div className="font-display text-xl font-bold mb-4">{title}</div>
        {children}
      </div>
    </section>
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
    <span className={`font-display font-extrabold tabular-nums text-xl ${tone}`}>
      {score}
    </span>
  );
}
