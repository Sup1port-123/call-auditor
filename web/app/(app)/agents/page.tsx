import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function AgentsPage() {
  const supabase = await createClient();

  const { data: agents, error } = await supabase
    .from("agents")
    .select("id, name, target, created_at")
    .order("created_at", { ascending: false });

  // audit counts + avg score per agent
  const { data: auditRows } = await supabase
    .from("audits")
    .select("agent_id, overall_score");

  const stats = new Map<string, { count: number; sum: number; scored: number }>();
  for (const row of auditRows ?? []) {
    if (!row.agent_id) continue;
    const s = stats.get(row.agent_id) ?? { count: 0, sum: 0, scored: 0 };
    s.count += 1;
    if (row.overall_score != null) {
      s.sum += row.overall_score;
      s.scored += 1;
    }
    stats.set(row.agent_id, s);
  }

  return (
    <div className="px-10 lg:px-16 py-14 max-w-6xl">
      <div className="flex items-end justify-between mb-10">
        <div>
          <div className="text-xs uppercase tracking-[0.25em] text-[var(--sky-700)] font-semibold mb-3">
            Agents
          </div>
          <h1 className="font-display text-5xl md:text-6xl font-extrabold tracking-tight leading-[1.02]">
            Who Otis{" "}
            <span className="bg-gradient-to-r from-[var(--sky-700)] via-[var(--violet-500)] to-[var(--pink-500)] bg-clip-text text-transparent">
              audits for.
            </span>
          </h1>
          <p className="text-zinc-500 mt-3 max-w-xl">
            Each agent has its own knowledge base. Audits run against the
            chosen agent&apos;s KB so product-accuracy and compliance get
            graded on real facts.
          </p>
        </div>
        <Link
          href="/agents/new"
          className="rounded-full bg-[var(--ink)] text-white px-6 py-2.5 text-sm font-medium hover:bg-zinc-800 transition shadow-[0_8px_24px_-12px_rgba(15,23,42,0.4)]"
        >
          + Add agent
        </Link>
      </div>

      {error && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 text-rose-700 text-sm px-5 py-3 mb-6">
          Couldn&apos;t load agents: {error.message}. Did you run the agents
          migration?
        </div>
      )}

      {agents && agents.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {agents.map((agent, i) => {
            const s = stats.get(agent.id);
            const avg =
              s && s.scored > 0 ? (s.sum / s.scored).toFixed(1) : "—";
            return (
              <Link
                key={agent.id}
                href={`/agents/${agent.id}`}
                className="group relative rounded-3xl bg-[var(--paper)] p-7 hover:bg-[var(--paper-strong)] transition"
              >
                <span className="absolute top-5 right-6 font-mono text-xs text-zinc-400">
                  ({String(i + 1).padStart(2, "0")})
                </span>
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-[var(--sky-200)] to-[var(--violet-500)] mb-5" />
                <div className="font-display text-2xl font-bold mb-1">
                  {agent.name}
                </div>
                <p className="text-sm text-zinc-600 leading-relaxed min-h-[2.5rem]">
                  {agent.target || "No target set."}
                </p>
                <div className="flex items-center gap-5 mt-5 pt-5 border-t border-white">
                  <Metric label="Audits" value={s?.count ?? 0} />
                  <Metric label="Avg score" value={avg} />
                </div>
              </Link>
            );
          })}
        </div>
      ) : (
        !error && (
          <div className="rounded-3xl bg-[var(--paper)] p-16 text-center">
            <div className="text-zinc-500 text-sm">
              No agents yet. Add one with a knowledge base and audits can be
              graded against it.
            </div>
            <Link
              href="/agents/new"
              className="inline-block mt-5 rounded-full bg-[var(--ink)] text-white px-6 py-2.5 text-sm font-medium hover:bg-zinc-800 transition"
            >
              + Add your first agent
            </Link>
          </div>
        )
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <div className="font-display text-xl font-bold tabular-nums">
        {value}
      </div>
      <div className="text-[10px] uppercase tracking-widest text-zinc-500 mt-0.5">
        {label}
      </div>
    </div>
  );
}
