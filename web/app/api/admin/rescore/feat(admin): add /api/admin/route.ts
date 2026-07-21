import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { finalizeAudit } from "@/lib/finalize";

export const runtime = "nodejs";
export const maxDuration = 60;

// Admin endpoint: reset a completed/failed audit back to transcribing and re-score it.
// POST /api/admin/rescore  body: { audit_id: string }
export async function POST(req: Request) {
  try {
    const { audit_id } = await req.json();
    if (!audit_id) {
      return NextResponse.json({ error: "audit_id required" }, { status: 400 });
    }

    const supabase = createAdminClient();

    // Fetch current audit to make sure it has a transcript
    const { data: audit } = await supabase
      .from("audits")
      .select("id, status, transcript_id, transcript")
      .eq("id", audit_id)
      .maybeSingle();

    if (!audit) {
      return NextResponse.json({ error: "Audit not found" }, { status: 404 });
    }

    if (!audit.transcript_id && !audit.transcript) {
      return NextResponse.json({ error: "Audit has no transcript — cannot re-score" }, { status: 400 });
    }

    // Reset to transcribing so finalizeAudit can claim and re-score it
    await supabase
      .from("audits")
      .update({ status: "transcribing", error_message: null })
      .eq("id", audit_id);

    // Re-score synchronously
    const result = await finalizeAudit(audit_id);

    return NextResponse.json({ ok: true, audit_id, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
