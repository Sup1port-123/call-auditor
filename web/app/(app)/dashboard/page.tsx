import { createClient } from "@/lib/supabase/server";
import DashboardClient from "./dashboard-client";
import {
  parseAuditFilters,
  hasAnyFilter,
  dateBounds,
  callIdOrClause,
  type RawParams,
} from "@/lib/audit-filters";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Cap on rows pulled for the filtered view. The dataset is small; if it ever
// grows past this, the filtered count/averages would undercount.
const FILTER_CAP = 2000;

const LIST_COLUMNS =
  "id, timestamp, target, llm_provider, overall_score, duration_seconds";

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
    // One query for the whole matching set; cards + list derive from it.
    // Filters MUST be applied before .order()/.limit() — supabase-js drops the
    // filter methods from the builder type once a transform is chained.
    let q = supabase.from("audits").select(LIST_COLUMNS);

    const b = dateBounds(filters);
    if (b.gte) q = q.gte("timestamp", b.gte);
    if (b.lte) q = q.lte("timestamp", b.lte);

    const orClause = callIdOrClause(filters);
    if (orClause) q = q.or(orClause);

    if (filters.durOp) {
      // Exclude nulls and the -1 "unknown" backfill sentinel.
      q = q.gte("duration_seconds", 0);
      const v = filters.durMin;
      if (filters.durOp === "gt" && v != null) q = q.gt("duration_seconds", v);
      else if (filters.durOp === "lt" && v != null)
        q = q.lt("duration_seconds", v);
      else if (filters.durOp === "eq" && v != null)
        q = q.eq("duration_seconds", v);
      else if (filters.durOp === "between") {
        if (filters.durMin != null) q = q.gte("duration_seconds", filters.durMin);
        if (filters.durMax != null) q = q.lte("duration_seconds", filters.durMax);
      }
    }

    if (filters.scoreOp) {
      const v = filters.scoreMin;
      if (filters.scoreOp === "gt" && v != null) q = q.gt("overall_score", v);
      else if (filters.scoreOp === "lt" && v != null)
        q = q.lt("overall_score", v);
      else if (filters.scoreOp === "eq" && v != null)
        q = q.eq("overall_score", v);
      else if (filters.scoreOp === "between") {
        if (filters.scoreMin != null)
          q = q.gte("overall_score", filters.scoreMin);
        if (filters.scoreMax != null)
          q = q.lte("overall_score", filters.scoreMax);
      }
    }

    const { data, error } = await q
      .order("timestamp", { ascending: false })
      .limit(FILTER_CAP);
    const rows = data ?? [];

    const scored = rows.filter((r) => r.overall_score != null);
    const avgScore =
      scored.length > 0
        ? scored.reduce((a, r) => a + (r.overall_score ?? 0), 0) / scored.length
        : null;

    const timed = rows.filter(
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
        matchCount={rows.length}
        avgScore={avgScore}
        avgDuration={avgDuration}
        recent={rows.slice(0, 50)}
        filters={sp}
        error={error?.message ?? null}
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
        .select(LIST_COLUMNS)
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
