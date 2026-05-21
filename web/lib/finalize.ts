import { createAdminClient } from "@/lib/supabase/admin";
import { getAssemblyClient, scoreTranscript } from "@/lib/auditor";

type TranscriptLike = {
  status?: string;
  error?: string | null;
  text?: string | null;
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
// This is the resilience path — it works whether or not the AssemblyAI
// webhook ever reaches us.
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
    // Already being scored (or done) by someone else.
    const { data: fresh } = await supabase
      .from("audits")
      .select("status")
      .eq("id", auditId)
      .maybeSingle();
    return { status: fresh?.status ?? "unknown" };
  }

  // Pull the transcript straight from AssemblyAI.
  let t: TranscriptLike;
  try {
    t = (await getAssemblyClient().transcripts.get(
      audit.transcript_id,
    )) as TranscriptLike;
  } catch {
    // Couldn't reach AssemblyAI — revert so a later poll retries.
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
    // Still processing — put it back and let the next poll try again.
    await supabase
      .from("audits")
      .update({ status: "transcribing" })
      .eq("id", auditId);
    return { status: "transcribing" };
  }

  const transcriptText = formatTranscript(t);

  let agentName: string | undefined;
  let knowledgeBase: string | undefined;
  if (audit.agent_id) {
    const { data: agent } = await supabase
      .from("agents")
      .select("name, knowledge_base")
      .eq("id", audit.agent_id)
      .maybeSingle();
    agentName = agent?.name ?? undefined;
    knowledgeBase = agent?.knowledge_base ?? undefined;
  }

  try {
    const evaluation = await scoreTranscript({
      transcript: transcriptText,
      preset: audit.preset ?? undefined,
      strictness: audit.strictness ?? undefined,
      customFocus: audit.custom_focus ?? undefined,
      agentName,
      knowledgeBase,
    });
    await supabase
      .from("audits")
      .update({
        status: "completed",
        transcript: transcriptText,
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
        error_message: `LLM scoring failed: ${message}`,
      })
      .eq("id", auditId);
    return { status: "failed" };
  }
}
