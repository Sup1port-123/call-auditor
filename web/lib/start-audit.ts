import { createAdminClient } from "@/lib/supabase/admin";
import { submitTranscription } from "@/lib/auditor";
import { finalizeAudit } from "@/lib/finalize";

export type AuditOptions = {
  agent_id?: string | null;
  preset?: string;
  strictness?: string;
  custom_focus?: string;
};

export function newAuditId(): string {
  const d = new Date();
  const stamp =
    d.toISOString().slice(0, 19).replace(/[-:T]/g, "").replace("T", "-");
  return `${stamp}-${Math.random().toString(16).slice(2, 8)}`;
}

function auditRowFields(opts: AuditOptions) {
  return {
    agent_id: opts.agent_id || null,
    preset: opts.preset || "general",
    strictness: opts.strictness || "standard",
    custom_focus: opts.custom_focus || "",
  };
}

// Create an audit for a recording URL and submit it for transcription.
// Scoring happens later via the webhook / status poller, or right away when
// the transcription provider answers synchronously.
export async function startRecordingAudit(opts: AuditOptions & {
  audioUrl: string;
  origin: string;
}): Promise<{ id: string } | { error: string; status: number }> {
  const id = newAuditId();
  const supabase = createAdminClient();

  const { error: insertErr } = await supabase.from("audits").insert({
    id,
    timestamp: new Date().toISOString(),
    source: "next-app",
    target: opts.audioUrl,
    ...auditRowFields(opts),
    status: "transcribing",
  });

  if (insertErr) {
    return { error: `Could not create audit row: ${insertErr.message}`, status: 500 };
  }

  try {
    const { transcriptId, transcript, durationSeconds } =
      await submitTranscription({
        audioUrl: opts.audioUrl,
        webhookUrl: `${opts.origin}/api/audits/webhook`,
        auditId: id,
      });

    const updateFields: Record<string, unknown> = {
      transcript_id: transcriptId,
    };
    if (transcript !== undefined) {
      updateFields.transcript = transcript;
      updateFields.duration_seconds = durationSeconds ?? null;
    }
    await supabase.from("audits").update(updateFields).eq("id", id);

    if (transcript !== undefined) {
      finalizeAudit(id).catch((err) =>
        console.error("[otis] finalizeAudit error:", err),
      );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await supabase
      .from("audits")
      .update({ status: "failed", error_message: message })
      .eq("id", id);
    return { error: `Transcription submission failed: ${message}`, status: 502 };
  }

  return { id };
}

// Create an audit from an already-written transcript (no transcription step)
// and score it. The `upload_` transcript id tells finalizeAudit to read the
// stored transcript instead of asking AssemblyAI.
export async function startTranscriptAudit(opts: AuditOptions & {
  transcript: string;
  fileName: string;
}): Promise<{ id: string } | { error: string; status: number }> {
  const id = newAuditId();
  const supabase = createAdminClient();

  const { error: insertErr } = await supabase.from("audits").insert({
    id,
    timestamp: new Date().toISOString(),
    source: "next-app",
    target: `file: ${opts.fileName}`,
    ...auditRowFields(opts),
    status: "transcribing",
    transcript_id: `upload_${id}`,
    transcript: opts.transcript,
    duration_seconds: null,
  });

  if (insertErr) {
    return { error: `Could not create audit row: ${insertErr.message}`, status: 500 };
  }

  // Await so the audit is usually complete by the time the page opens; if the
  // function is cut short, the status poller finishes it.
  try {
    await finalizeAudit(id);
  } catch (err) {
    console.error("[otis] finalizeAudit error:", err);
  }

  return { id };
}
