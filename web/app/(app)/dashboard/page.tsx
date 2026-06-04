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

const LIST_COLUMNS =
  "id, timestamp, audited_at, target, llm_provider, overall_score, duration_seconds";

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
    const q = applyAuditFilters(
      supabase.from("audits").select(LIST_COLUMNS),
      filters,
    );

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
