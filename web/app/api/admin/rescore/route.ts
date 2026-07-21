import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { finalizeAudit } from "@/lib/finalize";

export const runtime = "nodejs";
export const maxDuration = 60;

// POST /api/admin/rescore
// Body options:
//   { audit_id: string }            — re-score a single audit
//   { find_hold_calls: true }       — re-score ALL completed audits that are hold/no-interaction calls
//   { batch_id: string, find_hold_calls: true } — same, scoped to one batch
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const supabase = createAdminClient();

    // ── Single audit rescore ──────────────────────────────────────────────
    if (body.audit_id) {
      const { data: audit } = await supabase
        .from("audits")
        .select("id, transcript_id, transcript")
        .eq("id", body.audit_id)
        .maybeSingle();

      if (!audit) return NextResponse.json({ error: "Not found" }, { status: 404 });
      if (!audit.transcript_id && !audit.transcript)
        return NextResponse.json({ error: "No transcript" }, { status: 400 });

      await supabase.from("audits")
        .update({ status: "transcribing", error_message: null })
        .eq("id", body.audit_id);

      const result = await finalizeAudit(body.audit_id);
      return NextResponse.json({ ok: true, audit_id: body.audit_id, ...result });
    }

    // ── Bulk hold-call rescore ─────────────────────────────────────────────
    if (body.find_hold_calls) {
      // Find completed audits where summary or transcript indicates no real conversation.
      // Keywords: "on hold", "non-interaction", "no interaction", "hold message"
      let query = supabase
        .from("audits")
        .select("id, summary, overall_score")
        .eq("status", "completed");

      if (body.batch_id) query = query.eq("batch_id", body.batch_id);

      const { data: audits } = await query.limit(2000);

      if (!audits || audits.length === 0)
        return NextResponse.json({ ok: true, found: 0, rescored: 0 });

      // Filter locally for hold-call patterns in summary
      const holdKeywords = ["on hold", "non-interaction", "no interaction",
        "no substantive dialogue", "hold message", "could not be meaningfully",
        "cannot be meaningfully", "no real conversation", "no actual interaction",
        "no customer interaction", "call was on hold"];

      const holdAudits = audits.filter(a => {
        if (!a.summary) return false;
        const s = a.summary.toLowerCase();
        return holdKeywords.some(kw => s.includes(kw));
      });

      if (holdAudits.length === 0)
        return NextResponse.json({ ok: true, found: 0, rescored: 0, message: "No hold calls found" });

      // Reset all to transcribing
      const ids = holdAudits.map(a => a.id);
      await supabase.from("audits")
        .update({ status: "transcribing", error_message: null })
        .in("id", ids);

      // Re-score with concurrency limit of 3
      let rescored = 0;
      const failed: string[] = [];
      const CONCURRENCY = 3;

      for (let i = 0; i < ids.length; i += CONCURRENCY) {
        const chunk = ids.slice(i, i + CONCURRENCY);
        await Promise.all(chunk.map(async (id) => {
          try {
            await finalizeAudit(id);
            rescored++;
          } catch (err) {
            console.error("[otis] rescore failed for", id, err);
            failed.push(id);
          }
        }));
      }

      return NextResponse.json({ ok: true, found: holdAudits.length, rescored, failed });
    }

    return NextResponse.json({ error: "Provide audit_id or find_hold_calls:true" }, { status: 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
