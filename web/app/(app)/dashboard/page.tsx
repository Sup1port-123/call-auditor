import { createClient } from "@/lib/supabase/server";
import DashboardClient from "./dashboard-client";
import {
  parseAuditFilters,
  hasAnyFilter,
  applyAuditFilters,
  type RawParams,
} from "@/lib/audit-filters";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Cap on rows pulled for the filtered view.
const FILTER_CAP = 2000;

// How many rows the table renders (and fetches full insight for).
const DISPLAY_LIMIT = 50;

// Light columns — cheap to pull over the whole matching set for the stat cards.
const LIGHT_COLUMNS =
  "id, timestamp, audited_at, target, llm_provider, overall_score, duration_seconds, review_status";

// Full columns incl. the heavy insight fields — only for the displayed rows.
const FULL_COLUMNS =
  "id, timestamp, audited_at, target, llm_provider, overall_score, duration_seconds, review_status, summary, scores_json, strengths, what_was_lacking, recommendations_json, transcript";

export type LeaderboardEntry = {
  agentId: string;
  name: string;
  avgScore: number;
  count: number;
};

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<RawParams>;
}) {
  const sp = await searchParams;
  const supabase = await createClient();
  const filters = parseAuditFilters(sp);
  const filtered = hasAnyFilter(filters);

  // Agents power the dashboard "Agent" filter dropdown.
  const { data: agentOptions } = await supabase
    .from("agents")
    .select("id, name")
    .order("created_at", { ascending: false });
  const agents = agentOptions ?? [];

  if (filtered) {
    const statsQuery = applyAuditFilters(
      supabase.from("audits").select(LIGHT_COLUMNS),
      filters,
    );
    const { data: statsData, error: statsError } = await statsQuery
      .order("timestamp", { ascending: false })
      .limit(FILTER_CAP);
    const all = statsData ?? [];

    const displayQuery = applyAuditFilters(
      supabase.from("audits").select(FULL_COLUMNS),
      filters,
    );
    const { data: displayData, error: displayError } = await displayQuery
      .order("timestamp", { ascending: false })
      .limit(DISPLAY_LIMIT);

    const scored = all.filter((r) => r.overall_score != null);
    const avgScore =
      scored.length > 0
        ? scored.reduce((a, r) => a + (r.overall_score ?? 0), 0) / scored.length
        : null;

    const timed = all.filter(
      (r) => r.duration_seconds != null && r.duration_seconds >= 0,
    );
    const avgDuration =
      timed.length > 0
        ? Math.round(
            timed.reduce((a, r) => a + (r.duration_seconds ?? 0), 0) /
              timed.length,
          )
        : null;

    return (
      <DashboardClient
        filtered
        matchCount={all.length}
        avgScore={avgScore}
        avgDuration={avgDuration}
        recent={displayData ?? []}
        filters={sp}
        agentOptions={agents}
        error={(statsError ?? displayError)?.message ?? null}
      />
    );
  }

  // Default (unfiltered) view — the original dashboard.
  const since = new Date();
  since.setDate(since.getDate() - 7);

  const [{ count: weekCount }, { count: totalCount }, { data: recent }] =
    await Promise.all([
      supabase
        .from("audits")
        .select("*", { count: "exact", head: true })
        .gte("timestamp", since.toISOString()),
      supabase.from("audits").select("*", { count: "exact", head: true }),
      supabase
        .from("audits")
        .select(FULL_COLUMNS)
        .order("timestamp", { ascending: false })
        .limit(5),
    ]);

  const { data: scored } = await supabase
    .from("audits")
    .select("overall_score")
    .not("overall_score", "is", null);

  const avgScore =
    scored && scored.length > 0
      ? scored.reduce((a, r) => a + (r.overall_score ?? 0), 0) / scored.length
      : null;

  // Leaderboard: agents ranked by avg score this week
  const { data: lbRows } = await supabase
    .from("audits")
    .select("agent_id, overall_score, agents(name)")
    .gte("timestamp", since.toISOString())
    .not("overall_score", "is", null)
    .not("agent_id", "is", null);

  const agentMap = new Map<string, { name: string; scores: number[] }>();
  for (const row of (lbRows ?? [])) {
    const agentId = row.agent_id as string;
    const name =
      (row.agents as { name?: string } | null)?.name ?? "Unknown";
    const score = row.overall_score as number;
    if (!agentMap.has(agentId)) agentMap.set(agentId, { name, scores: [] });
    agentMap.get(agentId)!.scores.push(score);
  }
  const leaderboard: LeaderboardEntry[] = Array.from(agentMap.entries())
    .map(([agentId, { name, scores }]) => ({
      agentId,
      name,
      avgScore: scores.reduce((a, b) => a + b, 0) / scores.length,
      count: scores.length,
    }))
    .sort((a, b) => b.avgScore - a.avgScore);

  return (
    <DashboardClient
      weekCount={weekCount ?? 0}
      totalCount={totalCount ?? 0}
      avgScore={avgScore}
      recent={recent ?? []}
      filters={sp}
      agentOptions={agents}
      leaderboard={leaderboard}
    />
  );
}
