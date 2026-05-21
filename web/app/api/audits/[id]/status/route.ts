import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { finalizeAudit } from "@/lib/finalize";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("audits")
    .select("status, error_message, transcript_id")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  // Self-heal: if the row is stuck in `transcribing` and AssemblyAI has a
  // transcript for it, finish the audit here. This makes the webhook
  // optional — polling alone drives audits to completion.
  if (data.status === "transcribing" && data.transcript_id) {
    try {
      const r = await finalizeAudit(id);
      const { data: fresh } = await supabase
        .from("audits")
        .select("status, error_message")
        .eq("id", id)
        .maybeSingle();
      return NextResponse.json(
        {
          status: fresh?.status ?? r.status,
          error_message: fresh?.error_message ?? null,
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    } catch (err) {
      console.error("[otis] finalize from status poll failed:", err);
      // fall through and return the unchanged status
    }
  }

  return NextResponse.json(
    { status: data.status, error_message: data.error_message },
    { headers: { "Cache-Control": "no-store" } },
  );
}
