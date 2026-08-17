// app/api/audits/stats/route.ts
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const from = searchParams.get("from") ?? "2026-06-29";
  const to = searchParams.get("to") ?? new Date().toISOString().slice(0, 10);
  const fmt = searchParams.get("format") ?? "json";
  const fromISO = `${from}T00:00:00+05:30`;
  const toISO = `${to}T23:59:59+05:30`;
  const supabase = createAdminClient();
  const { data: audits, error } = await supabase
    .from("audits")
    .select("id, status, timestamp, overall_score, agent_id, agents(name)")
    .gte("timestamp", fromISO)
    .lte("timestamp", toISO)
    .order("timestamp", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const rows = audits ?? [];
  const total = rows.length;
  const completed = rows.filter((r) => r.status === "completed").length;
  const failed = rows.filter((r) => r.status === "failed").length;
  const inProg = rows.filter((r) => ["in_progress","transcribing","scoring"].includes(r.status ?? "")).length;
  const scored = rows.filter((r) => r.overall_score != null);
  const avgScore = scored.length ? +(scored.reduce((s, r) => s + (r.overall_score ?? 0), 0) / scored.length).toFixed(2) : null;
  type AgentRow = { name: string; total: number; completed: number; avgScore: number | null };
  const byAgent = new Map<string, AgentRow>();
  for (const r of rows) {
    const n = (r.agents as { name?: string } | null)?.name ?? r.agent_id ?? "Unknown";
    const ex = byAgent.get(n) ?? { name: n, total: 0, completed: 0, avgScore: null };
    ex.total += 1;
    if (r.status === "completed") ex.completed += 1;
    byAgent.set(n, ex);
  }
  for (const [key, row] of byAgent) {
    const agentRows = rows.filter((r) => ((r.agents as { name?: string } | null)?.name ?? r.agent_id ?? "Unknown") === key && r.overall_score != null);
    row.avgScore = agentRows.length ? +(agentRows.reduce((s, r) => s + (r.overall_score ?? 0), 0) / agentRows.length).toFixed(2) : null;
  }
  const byDay = new Map<string, { total: number; completed: number }>();
  for (const r of rows) {
    const day = (r.timestamp ?? "").slice(0, 10);
    const ex = byDay.get(day) ?? { total: 0, completed: 0 };
    ex.total += 1;
    if (r.status === "completed") ex.completed += 1;
    byDay.set(day, ex);
  }
  if (fmt === "json") {
    return NextResponse.json({ from, to, total, completed, failed, in_progress: inProg, avgScore,
      byAgent: Object.fromEntries(byAgent), byDay: Object.fromEntries(byDay) });
  }
  const XLSX = await import("xlsx");
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ["GroMo · Otis Audit Stats"], [`Period: ${from} to ${to}`], [],
    ["Metric","Value"], ["Total",total], ["Completed",completed], ["Failed",failed],
    ["In Progress",inProg], ["Avg Score",avgScore ?? "—"],
  ]), "Summary");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ["Agent","Total","Completed","Failed","Avg Score"],
    ...[...byAgent.values()].map(a=>[a.name,a.total,a.completed,a.total-a.completed,a.avgScore ?? "—"]),
  ]), "By Agent");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ["Date","Total","Completed"],
    ...[...byDay.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([d,v])=>[d,v.total,v.completed]),
  ]), "By Day");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const buf = new Uint8Array(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as any);
  return new Response(buf, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="otis-stats-${from}-to-${to}.xlsx"`,
    },
  });
}
