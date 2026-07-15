import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { submitTranscription } from "@/lib/auditor";
import { finalizeAudit } from "@/lib/finalize";

export const runtime = "nodejs";
export const maxDuration = 60;

type KartaWebhookPayload = {
  event?: string;
  call?: {
    call_id?: string;
    agent_id?: string;
    agent_name?: string;
    call_status?: string;
    recording_link?: string;
    from_number?: string;
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

    if (String(call.call_status ?? "").toLowerCase() !== "ended") {
      return NextResponse.json({ skipped: "not ended", status: call.call_status });
    }

    const recordingLink = call.recording_link?.replace(/\s+/g, "");
    if (!recordingLink || !/^https?:\/\//i.test(recordingLink)) {
      return NextResponse.json({ skipped: "no valid recording" });
    }

    const supabase = createAdminClient();
    const { data: agents } = await supabase.from("agents").select("id, name");
    const agentName = String(call.agent_name ?? "").trim();
    const match = (agents ?? []).find(
      (a) => a.name.toLowerCase().trim() === agentName.toLowerCase().trim()
    );
    const otisAgentId = match?.id ?? null;

    const auditId = newAuditId();
    const now = new Date().toISOString();
    const webhookUrl = `${new URL(req.url).origin}/api/audits/webhook`;

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

    try {
      const { transcriptId, transcript, durationSeconds } =
        await submitTranscription({
          audioUrl: recordingLink,
          webhookUrl,
          auditId,
        });

      const updateFields: Record<string, unknown> = { transcript_id: transcriptId };

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
