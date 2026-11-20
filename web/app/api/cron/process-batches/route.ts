import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 60;

// Keep working for this long per ping, leaving headroom under maxDuration.
const BUDGET_MS = 45_000;

// Batches used to advance only while someone kept the batch page open (the
// page drives /api/batches/[id]/process). Hit this from an external scheduler
// (cron-job.org) every ~5 minutes so batches finish, and their email goes
// out, with no tab open:
//   GET /api/cron/process-batches?key=YOUR_CRON_SECRET
// The daily-report cron also pings it.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const secret = process.env.CRON_SECRET;
  const authorized =
    !!secret &&
    (url.searchParams.get("key") === secret ||
      req.headers.get("authorization") === `Bearer ${secret}`);
  if (!authorized) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const started = Date.now();
  const supabase = createAdminClient();
  const { data: pending, error } = await supabase
    .from("audits")
    .select("batch_id")
    .not("batch_id", "is", null)
    .in("status", ["queued", "transcribing", "scoring"])
    .limit(2000);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Only fresh batches are worked on. Batch ids start with their creation date
  // (YYYYMMDD), so older batches that never finished are left alone instead of
  // being scored (and emailed) days later. Override with PROCESS_MAX_AGE_DAYS.
  const maxAgeDays = Number(process.env.PROCESS_MAX_AGE_DAYS ?? 2);
  const cutoff = new Date(Date.now() + 5.5 * 3600_000 - maxAgeDays * 86_400_000)
    .toISOString()
    .slice(0, 10)
    .replace(/-/g, "");
  const allIds = [...new Set((pending ?? []).map((r) => r.batch_id as string))];
  const batchIds = allIds.filter((id) => !/^\d{8}/.test(id) || id.slice(0, 8) >= cutoff);
  const skippedOld = allIds.length - batchIds.length;

  // An audit is moved to "scoring" while it is being scored; if the function
  // running it was cut off it stays there for good. Put those back so they are
  // scored again. Scoring takes seconds, so anything older than this is stuck.
  const staleBefore = new Date(Date.now() - 20 * 60_000).toISOString();
  if (batchIds.length > 0) {
    const { error: resetErr } = await supabase
      .from("audits")
      .update({ status: "transcribing" })
      .in("batch_id", batchIds)
      .eq("status", "scoring")
      .is("audited_at", null)
      .lt("timestamp", staleBefore);
    if (resetErr) console.error("[otis] process-batches: stale reset failed:", resetErr.message);
  }
  const prod = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  const base = prod ? `https://${prod}` : url.origin;

  const runs: Record<string, number> = {};
  // Round-robin so one large batch does not starve the others.
  let progressed = true;
  while (progressed && Date.now() - started < BUDGET_MS) {
    progressed = false;
    for (const id of batchIds) {
      if (Date.now() - started >= BUDGET_MS) break;
      try {
        const res = await fetch(`${base}/api/batches/${id}/process`, {
          method: "POST",
          signal: AbortSignal.timeout(Math.max(1000, BUDGET_MS - (Date.now() - started))),
        });
        const body = (await res.json().catch(() => ({}))) as {
          phase?: string; submitted?: number; finalized?: number;
        };
        runs[id] = (runs[id] ?? 0) + 1;
        if ((body.submitted ?? 0) > 0 || (body.finalized ?? 0) > 0) progressed = true;
      } catch (err) {
        console.error(`[otis] process-batches: ${id} failed:`, err);
      }
    }
  }

  return NextResponse.json({
    batches: batchIds.length,
    skipped_old_batches: skippedOld,
    runs,
    elapsed_ms: Date.now() - started,
  });
}
