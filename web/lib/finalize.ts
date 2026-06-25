import { createAdminClient } from "@/lib/supabase/admin";
import { getAssemblyClient, scoreTranscript } from "@/lib/auditor";
import { parseRubricJson, type RubricDimension } from "@/lib/rubric";

type TranscriptLike = {
  status?: string;
  error?: string | null;
  text?: string | null;
  audio_duration?: number | null;
  utterances?: { start?: number; speaker?: string; text?: string }[] | null;
};

function formatTranscript(t: TranscriptLike): string {
  const utterances = t.utterances ?? [];
  if (utterances.length === 0) return t.text ?? "";
  return utterances
    .map((u) => {
      const sec = Math.floor((u.start ?? 0) / 1000);
      const mm = String(Math.floor(sec / 60)).padStart(2, "0");
      const ss = String(sec % 60).padStart(2, "0");
      return `[${mm}:${ss}] Speaker ${u.speaker}: ${u.text}`;
    })
    .join("\n");
}

// Drive an audit from `transcribing` to `completed` / `failed`. Idempotent
// and safe to call concurrently: it claims the row with a conditional
// update, so overlapping pollers + the webhook can't double-score.
//
// Supports two transcription paths:
//   - AssemblyAI (async): transcript_id is a normal AssemblyAI ID
//   - Whisper (sync):     transcript_id starts with "whisper_" — the
//     transcript text is already stored in the audit row.
export async function finalizeAudit(
  auditId: string,
): Promise<{ status: string }> {
  const supabase = createAdminClient();

  const { data: audit } = await supabase
    .from("audits")
    .select("id, status, transcript_id, preset, strictness, custom_focus, agent_id")
    .eq("id", auditId)
    .maybeSingle();

  if (!audit) return { status: "not_found" };
  if (audit.status === "completed" || audit.status === "failed") {
    return { status: audit.status };
  }
  if (!audit.transcript_id) return { status: audit.status ?? "unknown" };

  // Claim: only one finalizer may move a row out of `transcribing`.
  const { data: claimed } = await supabase
    .from("audits")
    .update({ status: "scoring" })
    .eq("id", auditId)
    .eq("status", "transcribing")
    .select("id");

  if (!claimed || claimed.length === 0) {
    const { data: fresh } = await supabase
      .from("audits")
      .select("status")
      .eq("id", auditId)
      .maybeSingle();
    return { status: fresh?.status ?? "unknown" };
  }

  // ---------------------------------------------------------------------------
  // Fetch transcript — two paths depending on transcription provider.
  // ---------------------------------------------------------------------------
  let transcriptText: string;
  let durationSeconds: number | null;

  if (audit.transcript_id.startsWith("whisper_")) {
    // Whisper path: transcript was stored synchronously during submission.
    const { data: stored } = await supabase
      .from("audits")
      .select("transcript, duration_seconds")
      .eq("id", auditId)
      .maybeSingle();

    transcriptText = stored?.transcript ?? "";
    durationSeconds =
      typeof stored?.duration_seconds === "number"
        ? stored.duration_seconds
        : null;
  } else {
    // AssemblyAI path: fetch from their API.
    let t: TranscriptLike;
    try {
      t = (await getAssemblyClient().transcripts.get(
        audit.transcript_id,
      )) as TranscriptLike;
    } catch {
      await supabase
        .from("audits")
        .update({ status: "transcribing" })
        .eq("id", auditId);
      return { status: "transcribing" };
    }

    if (t.status === "error") {
      await supabase
        .from("audits")
        .update({
          status: "failed",
          error_message: `Transcription failed: ${t.error ?? "unknown"}`,
        })
        .eq("id", auditId);
      return { status: "failed" };
    }
    if (t.status !== "completed") {
      await supabase
        .from("audits")
        .update({ status: "transcribing" })
        .eq("id", auditId);
      return { status: "transcribing" };
    }

    transcriptText = formatTranscript(t);
    durationSeconds =
      typeof t.audio_duration === "number" && t.audio_duration >= 0
        ? Math.round(t.audio_duration)
        : null;
  }

  // ---------------------------------------------------------------------------
  // Load agent knowledge base + rubric, then score.
  // ---------------------------------------------------------------------------
  let agentName: string | undefined;
  let knowledgeBase: string | undefined;
  let rubric: RubricDimension[] | undefined;
  if (audit.agent_id) {
    const { data: agent } = await supabase
      .from("agents")
      .select("name, knowledge_base, rubric_json")
      .eq("id", audit.agent_id)
      .maybeSingle();
    agentName = agent?.name ?? undefined;
    knowledgeBase = agent?.knowledge_base ?? undefined;
    rubric = parseRubricJson(agent?.rubric_json) ?? undefined;
  }

  try {
    const evaluation = await scoreTranscript({
      transcript: transcriptText,
      preset: audit.preset ?? undefined,
      strictness: audit.strictness ?? undefined,
      customFocus: audit.custom_focus ?? undefined,
      agentName,
      knowledgeBase,
      rubric,
    });
    await supabase
      .from("audits")
      .update({
        status: "completed",
        transcript: transcriptText,
        duration_seconds: durationSeconds,
        audited_at: new Date().toISOString(),
        llm_provider: evaluation.llm_provider,
        llm_fallback_reason: evaluation.llm_fallback_reason,
        overall_score: evaluation.overall_score,
        summary: evaluation.summary,
        scores_json: JSON.stringify(evaluation.scores),
        strengths: evaluation.strengths,
        what_was_lacking: evaluation.what_was_lacking,
        recommendations_json: JSON.stringify(
          evaluation.improvement_recommendations,
        ),
      })
      .eq("id", auditId);
    return { status: "completed" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await supabase
      .from("audits")
      .update({
        status: "failed",
        transcript: transcriptText,
        duration_seconds: durationSeconds,
        audited_at: new Date().toISOString(),
        error_message: `LLM scoring failed: ${message}`,
      })
      .eq("id", auditId);
    return { status: "failed" };
  }
  }
