import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { finalizeAudit } from "@/lib/finalize";

export const runtime = "nodejs";
export const maxDuration = 300;

// Recovery: re-scores audits stuck in "scoring" (parent Vercel fn timed out mid-batch).
// GET /api/score-chunk?batch_id=XXX&chunk=5
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const batchId = searchParams.get("batch_id");
  const chunk = Math.min(parseInt(searchParams.get("chunk") || "5", 10), 20);
  if (!batchId) return NextResponse.json({ error: "batch_id required" }, { status: 400 });

  const supabase = createAdminClient();
  const { data: stuck } = await supabase
    .from("audits").select("id, status")
    .eq("batch_id", batchId).eq("status", "scoring").limit(chunk);

  const processed: string[] = [], errors: string[] = [];

  for (const audit of stuck ?? []) {
    try {
      const { data: reset } = await supabase
        .from("audits").update({ status: "transcribing" })
        .eq("id", audit.id).eq("status", "scoring").select("id");
      if (!reset || reset.length === 0) continue;
      const result = await finalizeAudit(audit.id);
      processed.push(audit.id + ":" + result.status);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(audit.id + ":" + msg.slice(0, 80));
      await supabase.from("audits").update({ status: "scoring" }).eq("id", audit.id).eq("status", "transcribing");
    }
  }

  const { count: remaining } = await supabase
    .from("audits").select("id", { count: "exact", head: true })
    .eq("batch_id", batchId).in("status", ["scoring", "transcribing", "queued"]);
  const { count: completed } = await supabase
    .from("audits").select("id", { count: "exact", head: true })
    .eq("batch_id", batchId).in("status", ["completed", "failed"]);

  return NextResponse.json({ done: (remaining ?? 0) === 0, processed: processed.length, errors: errors.length, completed, remaining, detail: processed });
}
