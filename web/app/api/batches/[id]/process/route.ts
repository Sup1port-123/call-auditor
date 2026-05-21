import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { submitTranscription } from "@/lib/auditor";
import { finalizeAudit } from "@/lib/finalize";

export const runtime = "nodejs";
export const maxDuration = 60;

// Per call: submit this many queued rows OR finalize this many
// transcribing rows. The batch view loops this endpoint until done, so
// each call stays well under the serverless timeout.
const SUBMIT_CHUNK = 8;
const FINALIZE_CHUNK = 4;

function webhookBase(req: Request): string {
  // Prefer the stable production domain — deployment-specific URLs sit
  // behind Vercel deployment protection and 401 the webhook.
  const prod = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (prod) return `https://${prod}`;
  return new URL(req.url).origin;
}

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

    // Phase 1: submit queued rows to AssemblyAI.
    const { data: queued } = await supabase
      .from("audits")
      .select("id, target")
      .eq("batch_id", id)
      .eq("status", "queued")
      .limit(SUBMIT_CHUNK);

    if (queued && queued.length > 0) {
      const webhookUrl = `${webhookBase(req)}/api/audits/webhook`;
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
        phase: "submit",
        submitted,
        failed,
        remaining: count ?? 0,
      });
    }

    // Phase 2: nothing left to submit — finalize transcribing rows. This
    // is the resilience path; it works even if the webhook never fires.
    const { data: transcribing } = await supabase
      .from("audits")
      .select("id")
      .eq("batch_id", id)
      .eq("status", "transcribing")
      .limit(FINALIZE_CHUNK);

    let finalized = 0;
    if (transcribing && transcribing.length > 0) {
      await Promise.all(
        transcribing.map(async (a) => {
          try {
            await finalizeAudit(a.id);
            finalized++;
          } catch (err) {
            console.error("[otis] batch finalize failed:", err);
          }
        }),
      );
    }

    const { count: stillTranscribing } = await supabase
      .from("audits")
      .select("*", { count: "exact", head: true })
      .eq("batch_id", id)
      .in("status", ["transcribing", "scoring"]);

    return NextResponse.json({
      phase: "finalize",
      finalized,
      remaining: 0,
      in_flight: stillTranscribing ?? 0,
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
