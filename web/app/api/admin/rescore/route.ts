import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { finalizeAudit } from "@/lib/finalize";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const { audit_id } = await req.json();
    if (!audit_id) return NextResponse.json({ error: "audit_id required" }, { status: 400 });

    const supabase = createAdminClient();
    const { data: audit } = await supabase
      .from("audits").select("id, transcript_id, transcript").eq("id", audit_id).maybeSingle();

    if (!audit) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (!audit.transcript_id && !audit.transcript) {
      return NextResponse.json({ error: "No transcript" }, { status: 400 });
    }

    await supabase.from("audits")
      .update({ status: "transcribing", error_message: null }).eq("id", audit_id);

    const result = await finalizeAudit(audit_id);
    return NextResponse.json({ ok: true, audit_id, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
