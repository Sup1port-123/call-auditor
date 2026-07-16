import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { submitTranscription } from "@/lib/auditor";
import { finalizeAudit } from "@/lib/finalize";

export const runtime = "nodejs";
export const maxDuration = 60;

// Minimum call duration (seconds) — skip calls shorter than this.
// Karta sends very short calls when the customer hangs up immediately
// or the call is dropped before any real conversation starts.
const MIN_DURATION_SECONDS = 30;

type KartaWebhookPayload = {
  event?: string;
  call?: {
    call_id?: string;
    agent_id?: string;
    agent_name?: string;
    call_status?: string;
    recording_link?: string;
    from_number?: string;
    duration?: number; // total call duration in seconds (if sent by Karta)
    talk_time?: number; // actual talk time in seconds (if sent by Karta)
  };
};

function newAuditId(): string {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, "");
  return `${stamp}-${Math.random().toString(16).slice(2, 8)}`;
}

export async function POST(req: Request) {
  try {
    let body: KartaWebhookPayload;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    if (body.event !== "call_ended") {
      return NextResponse.json({ skipped: "not call_ended" });
    }

    const call = body.call;
    if (!call) return NextResponse.json({ skipped: "no call object" });

    // Only process calls that actually ended (not dropped, missed, etc.)
    if (String(call.call_status ?? "").toLowerCase() !== "ended") {
      return NextResponse.json({ skipped: "not ended", status: call.call_status });
    }

    // Skip calls with no real conversation — too short to have meaningful content.
    // Use talk_time if available, otherwise fall back to duration.
    const callSeconds = call.talk_time ?? call.duration ?? null;
    if (callSeconds !== null && callSeconds < MIN_DURATION_SECONDS) {
      return NextResponse.json({
        skipped: "call_too_short",
        duration_seconds: callSeconds,
        min_required: MIN_DURATION_SECONDS,
      });
    }

    // Fix spaces in S3 URLs (Karta sometimes sends URLs with spaces)
    const recordingLink = call.recording_link?.replace(/\s+/g, "");
    if (!recordingLink || !/^https?:\/\//i.test(recordingLink)) {
      return NextResponse.json({ skipped: "no valid recording" });
    }

    const supabase = createAdminClient();

    // Match agent name to Otis agents (case-insensitive)
    const { data: agents } = await supabase.from("agents").select("id, name");
    const agentName = String(call.agent_name ?? "").trim();
    const match = (agents ?? []).find(
      (a) => a.name.toLowerCase().trim() === agentName.toLowerCase().trim()
    );
    const otisAgentId = match?.id ?? null;

    const auditId = newAuditId();
    const now = new Date().toISOString();
    const webhookUrl = `${new URL(req.url).origin}/api/audits/webhook`;

    // Insert audit row with status "transcribing"
    const { error: insertErr } = await supabase.from("audits").insert({
      id: auditId,
      timestamp: now,
      source: "webhook",
      target: recordingLink,
      call_id: call.call_id ?? null,
      mobile_number: call.from_number ?? null,
      preset: "general",
      strictness: "standard",
      custom_focus: "",
      agent_id: otisAgentId,
      batch_id: null,
      status: "transcribing",
    });

    if (insertErr) {
      return NextResponse.json({ error: insertErr.message }, { status: 500 });
    }

    // Submit to transcription and finalize
    try {
      const { transcriptId, transcript, durationSeconds } =
        await submitTranscription({
          audioUrl: recordingLink,
          webhookUrl,
          auditId,
        });

      const updateFields: Record<string, unknown> = {
        transcript_id: transcriptId,
      };

      if (transcript !== undefined) {
        updateFields.transcript = transcript;
        updateFields.duration_seconds = durationSeconds ?? null;
      }

      await supabase.from("audits").update(updateFields).eq("id", auditId);

      if (transcript !== undefined) {
        finalizeAudit(auditId).catch(console.error);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await supabase
        .from("audits")
        .update({ status: "failed", error_message: msg })
        .eq("id", auditId);
    }

    return NextResponse.json({
      received: true,
      audit_id: auditId,
      agent_name: agentName,
      otis_agent_id: otisAgentId,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
