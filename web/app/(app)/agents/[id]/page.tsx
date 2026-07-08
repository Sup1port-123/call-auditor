import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { istDateTime } from "@/lib/datetime";
import type { Agent } from "@/lib/types/agent";
import AgentEditor from "./agent-editor";

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

  return (
    <div className="px-10 lg:px-16 py-14 max-w-5xl">
      <Link
        href="/agents"
        className="text-xs uppercase tracking-[0.25em] text-zinc-400 hover:text-zinc-600 transition inline-block mb-6"
      >
        &larr; All agents
      </Link>

      <AgentEditor agent={agent} />

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
                    {istDateTime(a.timestamp)} IST
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
  const pct = Math.round(score * 20);
  const tone =
    pct >= 70
      ? "text-emerald-600"
      : pct >= 50
      ? "text-amber-600"
      : "text-rose-600";
  return (
    <span className={`font-display font-extrabold tabular-nums text-xl ${tone}`}>
      {pct}%
    </span>
  );
}
