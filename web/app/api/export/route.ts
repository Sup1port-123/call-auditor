import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
export const runtime = "nodejs";
export async function GET(req: Request) {
  const url = new URL(req.url);
  const secret = process.env.CRON_SECRET || "otis-cron-gromo-2026";
  if (url.searchParams.get("key") !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const date = url.searchParams.get("date") ?? new Date().toISOString().slice(0, 10);
  const supabase = createAdminClient();
  const { data: audits } = await supabase
    .from("audits")
    .select("id, timestamp, agent_id, call_id, mobile_number, overall_score, summary, strengths, what_was_lacking, duration_seconds, status, audited_at")
    .gte("timestamp", date + "T00:00:00.000Z")
    .lte("timestamp", date + "T23:59:59.999Z")
    .eq("status", "completed")
    .order("timestamp", { ascending: true });
  const { data: agents } = await supabase.from("agents").select("id, name");
  const agentMap = new Map((agents ?? []).map((a) => [a.id, a.name]));
  const rows = (audits ?? []).map((a) => ({
    audit_id: a.id,
    timestamp: a.timestamp,
    agent_name: agentMap.get(a.agent_id ?? "") ?? "Unknown",
    call_id: a.call_id ?? "",
    mobile_number: a.mobile_number ?? "",
    score: a.overall_score ?? "",
    duration_seconds: a.duration_seconds ?? "",
    summary: (a.summary ?? "").replace(/\n/g, " "),
    strengths: (a.strengths ?? "").replace(/\n/g, " "),
    what_was_lacking: (a.what_was_lacking ?? "").replace(/\n/g, " "),
    audited_at: a.audited_at ?? "",
  }));
  return NextResponse.json({ date, count: rows.length, audits: rows });
}
