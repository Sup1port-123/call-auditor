// @ts-nocheck
// web/app/api/convozen-batch/retry/route.ts
// Re-triggers Gemini scoring for audits stuck at "transcribing" status.
// Usage: GET /api/convozen-batch/retry?batchId=xxx
//        GET /api/convozen-batch/retry?batchId=xxx&limit=20
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { finalizeAudit } from "@/lib/finalize";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const batchId = searchParams.get("batchId");
  const limit = Math.min(parseInt(searchParams.get("limit") || "25"), 25);

  if (!batchId) {
    return NextResponse.json({ error: "batchId query param required" }, { status: 400 });
  }

  const db = createAdminClient();
  const { data: stuckAudits, error } = await db
    .from("audits")
    .select("id")
    .eq("batch_id", batchId)
    .eq("status", "transcribing")
    .limit(limit);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!stuckAudits || stuckAudits.length === 0) {
    return NextResponse.json({ message: "No stuck audits found for this batch.", retriggered: 0 });
  }

  // Process in parallel (limit keeps us under 300s)
  const outcomes = await Promise.all(
    stuckAudits.map(async ({ id }) => {
      try {
        const { status } = await finalizeAudit(id);
        return { id, status };
      } catch (e: any) {
        return { id, status: "error", error: e.message };
      }
    })
  );

  const completed = outcomes.filter((o) => o.status === "completed").length;
  const failed    = outcomes.filter((o) => o.status !== "completed").length;

  const { count: remaining } = await db
    .from("audits")
    .select("id", { count: "exact", head: true })
    .eq("batch_id", batchId)
    .eq("status", "transcribing");

  return NextResponse.json({ batchId, retriggered: stuckAudits.length, completed, failed, remaining });
}
