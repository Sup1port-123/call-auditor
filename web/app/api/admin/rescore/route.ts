import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { finalizeAudit } from "@/lib/finalize";

export const runtime = "nodejs";
export const maxDuration = 60;

const HOLD_KEYWORDS = [
  "on hold", "non-interaction", "no interaction",
  "no substantive dialogue", "hold message", "could not be meaningfully",
  "cannot be meaningfully", "no real conversation", "no actual interaction",
  "no customer interaction", "call was on hold", "placed on hold",
  "call is on hold", "please hold", "hold karo", "hold kar",
  "put the call on hold", "put on hold",
];

function isHoldCall(text: string): boolean {
  if (!text) return false;
  const lower = text.toLowerCase();
  return HOLD_KEYWORDS.some(kw => lower.includes(kw));
}

// POST /api/admin/rescore
// { audit_id }                               — single audit
// { find_hold_calls: true }                  — all completed audits (summary + transcript)
// { find_hold_calls: true, batch_id }        — scoped to one batch
// { find_hold_calls: true, offset, limit }   — paginated (default limit 20)
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const supabase = createAdminClient();

    // ── Single audit ──────────────────────────────────────────────────────
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

    // ── Bulk hold-call rescore ────────────────────────────────────────────
    if (body.find_hold_calls) {
      const offset = Number(body.offset ?? 0);
      const limit  = Number(body.limit  ?? 20);

      let query = supabase
        .from("audits")
        .select("id, summary, transcript")
        .eq("status", "completed")
        .range(offset, offset + limit - 1);

      if (body.batch_id) query = query.eq("batch_id", body.batch_id);

      const { data: audits } = await query;

      if (!audits || audits.length === 0)
        return NextResponse.json({ ok: true, found: 0, rescored: 0, done: true });

      // Filter: hold keywords in summary OR transcript
      const holdAudits = audits.filter(a =>
        isHoldCall(a.summary ?? "") || isHoldCall(a.transcript ?? "")
      );

      let rescored = 0;
      const failed: string[] = [];

      if (holdAudits.length > 0) {
        const ids = holdAudits.map(a => a.id);
        await supabase.from("audits")
          .update({ status: "transcribing", error_message: null })
          .in("id", ids);

        const CONCURRENCY = 3;
        for (let i = 0; i < ids.length; i += CONCURRENCY) {
          const chunk = ids.slice(i, i + CONCURRENCY);
          await Promise.all(chunk.map(async (id) => {
            try { await finalizeAudit(id); rescored++; }
            catch (err) { console.error("[otis] rescore failed:", id, err); failed.push(id); }
          }));
        }
      }

      return NextResponse.json({
        ok: true,
        scanned: audits.length,
        found: holdAudits.length,
        rescored,
        failed,
        done: audits.length < limit,
        next_offset: offset + limit,
      });
    }

    return NextResponse.json({ error: "Provide audit_id or find_hold_calls:true" }, { status: 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
