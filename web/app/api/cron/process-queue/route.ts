import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { submitTranscription } from "@/lib/auditor";
import { finalizeAudit } from "@/lib/finalize";

export const runtime = "nodejs";
export const maxDuration = 60;

// Drains ingested audits, scoped to source='ingest' so it never collides with
// the batch UI's own processing loop. Hit this every few minutes from the
// external scheduler (cron-job.org):
//   GET /api/cron/process-queue?key=YOUR_CRON_SECRET
// Each call submits a chunk of queued rows and finalizes a chunk of
// transcribing rows, so it stays under the serverless timeout; repeated calls
// drain the backlog. Throttled chunks keep LLM/transcription rate limits happy.

const SUBMIT_CHUNK = 8;
const FINALIZE_CHUNK = 4;

function webhookBase(req: Request): string {
  // Prefer the stable production domain — deployment URLs sit behind Vercel
  // deployment protection and would 401 the AssemblyAI webhook.
  const prod = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (prod) return `https://${prod}`;
  return new URL(req.url).origin;
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const secret = process.env.CRON_SECRET;
    if (!secret || url.searchParams.get("key") !== secret) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const supabase = createAdminClient();

    // Phase 1: submit queued ingested rows to AssemblyAI.
    const { data: queued } = await supabase
      .from("audits")
      .select("id, target")
      .eq("source", "ingest")
      .eq("status", "queued")
      .limit(SUBMIT_CHUNK);

    let submitted = 0;
    let submitFailed = 0;
    if (queued && queued.length > 0) {
      const webhookUrl = `${webhookBase(req)}/api/audits/webhook`;
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
            submitFailed++;
          }
        }),
      );
    }

    // Phase 2: finalize transcribing ingested rows (idempotent self-heal; also
    // covers any AssemblyAI webhook that was missed).
    const { data: transcribing } = await supabase
      .from("audits")
      .select("id")
      .eq("source", "ingest")
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
            console.error("[otis] process-queue finalize failed:", err);
          }
        }),
      );
    }

    const { count: queuedLeft } = await supabase
      .from("audits")
      .select("*", { count: "exact", head: true })
      .eq("source", "ingest")
      .eq("status", "queued");

    const { count: inFlight } = await supabase
      .from("audits")
      .select("*", { count: "exact", head: true })
      .eq("source", "ingest")
      .in("status", ["transcribing", "scoring"]);

    return NextResponse.json({
      submitted,
      submitFailed,
      finalized,
      queuedLeft: queuedLeft ?? 0,
      inFlight: inFlight ?? 0,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[otis] /api/cron/process-queue crashed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const POST = GET;
