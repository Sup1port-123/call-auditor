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

  const batchIds = [...new Set((pending ?? []).map((r) => r.batch_id as string))];
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
    runs,
    elapsed_ms: Date.now() - started,
  });
}
