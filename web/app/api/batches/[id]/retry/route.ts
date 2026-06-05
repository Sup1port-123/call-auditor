import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

// Reset a batch's failed audits so the normal process loop re-drives them.
// Rows that already transcribed (have a transcript_id) only need re-scoring →
// back to 'transcribing'. Rows that never transcribed go back to 'queued' to
// be re-submitted. Clears the old error_message either way.
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: "Missing batch id" }, { status: 400 });
    }

    const supabase = createAdminClient();

    // Already transcribed → just re-score.
    const { error: e1, count: rescored } = await supabase
      .from("audits")
      .update({ status: "transcribing", error_message: null }, {
        count: "exact",
      })
      .eq("batch_id", id)
      .eq("status", "failed")
      .not("transcript_id", "is", null);

    // Never transcribed → re-submit from scratch.
    const { error: e2, count: requeued } = await supabase
      .from("audits")
      .update({ status: "queued", error_message: null }, { count: "exact" })
      .eq("batch_id", id)
      .eq("status", "failed")
      .is("transcript_id", null);

    const err = e1 ?? e2;
    if (err) {
      console.error("[otis] batch retry failed:", err.message);
      return NextResponse.json({ error: err.message }, { status: 500 });
    }

    return NextResponse.json({
      retried: (rescored ?? 0) + (requeued ?? 0),
      rescored: rescored ?? 0,
      requeued: requeued ?? 0,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[otis] /api/batches/[id]/retry crashed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
