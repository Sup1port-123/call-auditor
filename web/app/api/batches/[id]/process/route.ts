import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { submitTranscription } from "@/lib/auditor";

export const runtime = "nodejs";
export const maxDuration = 60;

// How many recordings to submit to AssemblyAI per call. The client loops
// this endpoint until `remaining` hits 0, so each call stays well under
// the serverless timeout no matter how big the batch is.
const CHUNK = 8;

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;

    let supabase;
    try {
      supabase = createAdminClient();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return NextResponse.json(
        { error: `${message}. Add it in Vercel and redeploy.` },
        { status: 500 },
      );
    }

    const webhookUrl = `${new URL(req.url).origin}/api/audits/webhook`;

    const { data: queued, error } = await supabase
      .from("audits")
      .select("id, target")
      .eq("batch_id", id)
      .eq("status", "queued")
      .limit(CHUNK);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!queued || queued.length === 0) {
      return NextResponse.json({ submitted: 0, failed: 0, remaining: 0 });
    }

    let submitted = 0;
    let failed = 0;

    await Promise.all(
      queued.map(async (a) => {
        try {
          const { transcriptId } = await submitTranscription({
            audioUrl: a.target,
            webhookUrl,
            auditId: a.id,
          });
          await supabase
            .from("audits")
            .update({ status: "transcribing", transcript_id: transcriptId })
            .eq("id", a.id);
          submitted++;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          await supabase
            .from("audits")
            .update({ status: "failed", error_message: message })
            .eq("id", a.id);
          failed++;
        }
      }),
    );

    const { count } = await supabase
      .from("audits")
      .select("*", { count: "exact", head: true })
      .eq("batch_id", id)
      .eq("status", "queued");

    return NextResponse.json({
      submitted,
      failed,
      remaining: count ?? 0,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[otis] /api/batches/process crashed:", message);
    return NextResponse.json(
      { error: `Unexpected server error: ${message}` },
      { status: 500 },
    );
  }
}
