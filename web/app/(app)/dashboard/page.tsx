import { createClient } from "@/lib/supabase/server";
import DashboardClient from "./dashboard-client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function DashboardPage() {
  const supabase = await createClient();

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
        .select("id, timestamp, target, llm_provider, overall_score")
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
    />
  );
}
