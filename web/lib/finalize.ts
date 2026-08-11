import { createAdminClient } from "@/lib/supabase/admin";
import { getAssemblyClient, scoreTranscript } from "@/lib/auditor";
import { parseRubricJson, type RubricDimension } from "@/lib/rubric";

// Minimum words a transcript must have to be worth scoring.
const MIN_TRANSCRIPT_WORDS = 30;
// Minimum call duration (seconds)  -  calls shorter than this are not scored.
const MIN_CALL_DURATION_SECONDS = 60;

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

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

// Save the completed evaluation to the DB. If compliance_json column doesn't
// exist yet (pending migration), fall back to saving without it so audits
// still complete successfully.
async function saveCompleted(
  supabase: ReturnType<typeof createAdminClient>,
  auditId: string,
  fields: Record<string, unknown>,
): Promise<void> {
  const { error } = await supabase
    .from("audits")
    .update(fields)
    .eq("id", auditId);

  if (error?.message?.includes("compliance_json")) {
    // Column not yet added to Supabase  -  save without compliance data
    const { compliance_json: _omit, ...rest } = fields as Record<string, unknown> & { compliance_json?: unknown };
    await supabase.from("audits").update(rest).eq("id", auditId);
    return;
  }

  if (error) throw new Error(error.message);
}

export async function finalizeAudit(
  auditId: string,
): Promise<{ status: string }> {
  const supabase = createAdminClient();

  const { data: audit } = await supabase
    .from("audits")
    .select("id, status, transcript_id, preset, strictness, custom_focus, agent_id, disconnect_reason, batch_id")
    .eq("id", auditId)
    .maybeSingle();

  if (!audit) return { status: "not_found" };
  if (audit.status === "completed" || audit.status === "failed") {
    return { status: audit.status };
  }
  if (!audit.transcript_id) return { status: audit.status ?? "unknown" };

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

  let transcriptText: string;
  let durationSeconds: number | null;

  if (
    audit.transcript_id.startsWith("whisper_") ||
    audit.transcript_id.startsWith("sarvam_") ||
    audit.transcript_id.startsWith("deepgram_")
  ) {
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

  if (countWords(transcriptText) < MIN_TRANSCRIPT_WORDS) {
    await supabase
      .from("audits")
      .update({
        status: "failed",
        transcript: transcriptText,
        duration_seconds: durationSeconds,
        audited_at: new Date().toISOString(),
        error_message:
          "No meaningful conversation detected  -  call was too short or silent.",
      })
      .eq("id", auditId);
    return { status: "failed" };
  }

  if (durationSeconds !== null && durationSeconds < MIN_CALL_DURATION_SECONDS) {
    await supabase
      .from("audits")
      .update({
        status: "failed",
        transcript: transcriptText,
        duration_seconds: durationSeconds,
        audited_at: new Date().toISOString(),
        error_message: `Call too short to audit  -  ${durationSeconds}s is under the ${MIN_CALL_DURATION_SECONDS}s minimum.`,
      })
      .eq("id", auditId);
    return { status: "failed" };
  }

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

  // Prepend disconnect reason metadata for the LLM (kept separate from stored transcript so the raw transcript column stays clean).
const transcriptForScoring = audit.disconnect_reason
  ? `CALL METADATA:\nDisconnect Reason: ${audit.disconnect_reason}\n\n${transcriptText}`
  : transcriptText;

try {
    const evaluation = await scoreTranscript({
      transcript: transcriptForScoring,
      preset: audit.preset ?? undefined,
      strictness: audit.strictness ?? undefined,
      customFocus: audit.custom_focus ?? undefined,
      agentName,
      knowledgeBase,
      rubric,
    });

    // Non-interaction call detection  -  exclude these calls from quality metrics.
    const summaryLower = (evaluation.summary ?? "").toLowerCase();
    const isNonInteraction = [
      "no customer interaction",
      "no real conversation",
      "call was on hold",
      "non-interaction call",
      "no actual interaction",
      "cannot be meaningfully",
      "could not be meaningfully",
      "no substantive dialogue",
    ].some((kw) => summaryLower.includes(kw));

    if (isNonInteraction) {
      await saveCompleted(supabase, auditId, {
        status: "excluded",
        transcript: transcriptText,
        duration_seconds: durationSeconds,
        audited_at: new Date().toISOString(),
        overall_score: null,
        summary: evaluation.summary,
        error_message: "Non-interaction call  -  excluded from quality scoring",
      });
      return { status: "excluded" };
    }

    // Store script compliance + inbound call_reason in compliance_json.
    // call_reason is only present for inbound calls; stored under _call_reason key.
    const complianceData = {
      ...(evaluation.script_compliance ?? {}),
      ...(evaluation.call_reason ? { _call_reason: evaluation.call_reason } : {}),
    };

    await saveCompleted(supabase, auditId, {
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
      recommendations_json: JSON.stringify(evaluation.improvement_recommendations),
      compliance_json: JSON.stringify(complianceData),
    });

    if (evaluation.overall_score < 5) {
      const { sendLowScoreAlert } = await import("@/lib/alert");
      sendLowScoreAlert({
        auditId,
        agentName: agentName ?? "Unknown Agent",
        score: evaluation.overall_score,
        recommendations: evaluation.improvement_recommendations ?? [],
      }).catch(console.error);
    }

    // Auto-trigger batch completion email (non-blocking, best-effort).
  // Atomic guard: UPDATE .neq("last_sent_date", date) means only the
  // first concurrent caller wins — the rest update 0 rows and skip.
    if (audit.batch_id) {
      const batchIdSnap = audit.batch_id;
      Promise.resolve().then(async () => {
        const { count: inFlight } = await supabase
          .from("audits")
          .select("id", { count: "exact", head: true })
          .eq("batch_id", batchIdSnap)
          .in("status", ["queued", "transcribing", "scoring"]);
        if ((inFlight ?? 1) > 0) return;

        const { generateAndSendReport, istParts, parseEmails } = await import("@/lib/report");
        const { date } = istParts();

        // Atomic claim — only the first concurrent caller gets claimed.length > 0
        const { data: claimed } = await supabase
          .from("report_settings")
          .update({ last_sent_date: date })
          .eq("id", "default")
          .neq("last_sent_date", date)
          .select("id");
        if (!claimed || claimed.length === 0) return;

        const { data: settings } = await supabase
          .from("report_settings")
          .select("emails, enabled")
          .eq("id", "default")
          .maybeSingle();
        if (!settings?.enabled || !settings?.emails) return;

        const emails = parseEmails(settings.emails);
        if (emails.length > 0) {
          await generateAndSendReport({ emails, istDate: date });
        }
      }).catch(console.error);
    }

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
