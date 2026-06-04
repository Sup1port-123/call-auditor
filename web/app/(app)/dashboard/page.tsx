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

// Cap on rows pulled for the filtered view. The dataset is small; if it ever
// grows past this, the filtered count/averages would undercount.
const FILTER_CAP = 2000;

// How many rows the table renders (and fetches full insight for).
const DISPLAY_LIMIT = 50;

// Light columns — cheap to pull over the whole matching set for the stat cards.
const LIGHT_COLUMNS =
  "id, timestamp, audited_at, target, llm_provider, overall_score, duration_seconds";

// Full columns incl. the heavy insight fields — only for the displayed rows so
// they can be expanded inline. MUST stay one string literal (supabase-js parses
// it at compile time; `+` concatenation collapses the row type).
const FULL_COLUMNS =
  "id, timestamp, audited_at, target, llm_provider, overall_score, duration_seconds, summary, scores_json, strengths, what_was_lacking, recommendations_json, transcript";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<RawParams>;
}) {
  const sp = await searchParams;
  const supabase = await createClient();
  const filters = parseAuditFilters(sp);
  const filtered = hasAnyFilter(filters);

  if (filtered) {
    // Stats over the whole matching set (light columns only). Filters MUST be
    // applied before .order()/.limit() — supabase-js drops the filter methods
    // from the builder type once a transform is chained.
    const statsQuery = applyAuditFilters(
      supabase.from("audits").select(LIGHT_COLUMNS),
      filters,
    );
    const { data: statsData, error: statsError } = await statsQuery
      .order("timestamp", { ascending: false })
      .limit(FILTER_CAP);
    const all = statsData ?? [];

    // Display rows with full insight (top N) — fetched separately so the heavy
    // columns aren't pulled across the whole matching set.
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

  return (
    <DashboardClient
      weekCount={weekCount ?? 0}
      totalCount={totalCount ?? 0}
      avgScore={avgScore}
      recent={recent ?? []}
      filters={sp}
    />
  );
}
