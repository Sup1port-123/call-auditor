import { createAdminClient } from "@/lib/supabase/admin";
import { getAssemblyClient, scoreTranscript, type AuditScored } from "@/lib/auditor";
import { parseRubricJson, RUBRIC_DIMENSIONS, type RubricDimension } from "@/lib/rubric";

const MIN_TRANSCRIPT_WORDS = 30;
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

function computeNeedsReview(
  evaluation: AuditScored,
  durationSeconds: number | null,
  rubric: RubricDimension[],
): { needs_review: boolean; review_reason: string | null } {
  const reasons: string[] = [];
  const rubricTotalMax = rubric.reduce((sum, d) => sum + d.max, 0);
  const isStandardRubric = rubricTotalMax <= 10;

  if (evaluation.llm_fallback_reason) {
    reasons.push(`Used fallback LLM: ${evaluation.llm_fallback_reason}`);
  }

  const aiText = `${evaluation.summary ?? ""} ${evaluation.what_was_lacking ?? ""}`.toLowerCase();
  if (aiText.includes("diarization") || aiText.includes("speaker label")) {
    reasons.push("Diarization / speaker-label issues flagged by AI in its own rationale");
  }

  if (isStandardRubric && evaluation.overall_score <= 1) {
    reasons.push("Score at minimum (1/5) — verify transcript quality");
  }

  const complianceEntries = Object.entries(evaluation.script_compliance ?? {});
  const failCount = complianceEntries.filter(([, c]) => !c.passed).length;
  const totalChecks = complianceEntries.length;
  if (isStandardRubric && evaluation.overall_score >= 4 && failCount >= 3) {
    reasons.push(`Score ${evaluation.overall_score}/5 but ${failCount}/${totalChecks} compliance checks failed`);
  }

  if (totalChecks >= 4 && failCount === totalChecks) {
    reasons.push(`All ${totalChecks} compliance checks failed`);
  }

  if (durationSeconds !== null && durationSeconds < 90) {
    reasons.push(`Very short call (${durationSeconds}s) — limited content for scoring`);
  }

  const normalizedScores = Object.values(evaluation.scores)
    .filter((d) => d.score !== null && d.max != null && d.min != null)
    .map((d) => (d.score! - d.min!) / Math.max(1, d.max! - d.min!));
  if (normalizedScores.length >= 4) {
    const maxN = Math.max(...normalizedScores);
    const minN = Math.min(...normalizedScores);
    if (maxN - minN >= 0.8) {
      reasons.push("High score variance across dimensions — possible speaker mix-up");
    }
  }

  return {
    needs_review: reasons.length > 0,
    review_reason: reasons.length > 0 ? reasons.join("; ") : null,
  };
}

export async function finalizeAudit(auditId: string): Promise<{ status: string }> {
const supabase = createAdminClient();

const { data: audit } = await supabase
.from("audits")
.select("id, status, transcript_id, preset, strictness, custom_focus, agent_id, disconnect_reason, batch_id")
.eq("id", auditId)
.maybeSingle();

if (!audit) return { status: "not_found" };
if (audit.status === "completed" || audit.status === "failed") return { status: audit.status };
if (!audit.transcript_id) return { status: audit.status ?? "unknown" };

const { data: claimed } = await supabase
.from("audits")
.update({ status: "scoring" })
.eq("id", auditId)
.eq("status", "transcribing")
.select("id");

if (!claimed || claimed.length === 0) {
const { data: fresh } = await supabase.from("audits").select("status").eq("id", auditId).maybeSingle();
return { status: fresh?.status ?? "unknown" };
}

let transcriptText: string;
let durationSeconds: number | null;

if (
audit.transcript_id.startsWith("whisper_") ||
audit.transcript_id.startsWith("sarvam_") ||
audit.transcript_id.startsWith("deepgram_")
) {
const { data: stored } = await supabase.from("audits").select("transcript, duration_seconds").eq("id", auditId).maybeSingle();
transcriptText = stored?.transcript ?? "";
durationSeconds = typeof stored?.duration_seconds === "number" ? stored.duration_seconds : null;
} else {
let t: TranscriptLike;
try {
t = (await getAssemblyClient().transcripts.get(audit.transcript_id)) as TranscriptLike;
} catch {
await supabase.from("audits").update({ status: "transcribing" }).eq("id", auditId);
return { status: "transcribing" };
}

if (t.status === "error") {
await supabase.from("audits").update({ status: "failed", error_message: `Transcription failed: ${t.error ?? "unknown"}` }).eq("id", auditId);
return { status: "failed" };
}
if (t.status !== "completed") {
await supabase.from("audits").update({ status: "transcribing" }).eq("id", auditId);
return { status: "transcribing" };
}

transcriptText = formatTranscript(t);
durationSeconds = typeof t.audio_duration === "number" && t.audio_duration >= 0 ? Math.round(t.audio_duration) : null;
}

if (countWords(transcriptText) < MIN_TRANSCRIPT_WORDS) {
await supabase.from("audits").update({ status: "failed", transcript: transcriptText, duration_seconds: durationSeconds, audited_at: new Date().toISOString(), error_message: "No meaningful conversation detected - call was too short or silent." }).eq("id", auditId);
return { status: "failed" };
}

if (durationSeconds !== null && durationSeconds < MIN_CALL_DURATION_SECONDS) {
await supabase.from("audits").update({ status: "failed", transcript: transcriptText, duration_seconds: durationSeconds, audited_at: new Date().toISOString(), error_message: `Call too short to audit - ${durationSeconds}s is under the ${MIN_CALL_DURATION_SECONDS}s minimum.` }).eq("id", auditId);
return { status: "failed" };
}

let agentName: string | undefined;
let knowledgeBase: string | undefined;
let rubric: RubricDimension[] | undefined;
if (audit.agent_id) {
const { data: agent } = await supabase.from("agents").select("name, knowledge_base, rubric_json").eq("id", audit.agent_id).maybeSingle();
agentName = agent?.name ?? undefined;
knowledgeBase = agent?.knowledge_base ?? undefined;
rubric = parseRubricJson(agent?.rubric_json) ?? undefined;
}

const effectiveRubric = rubric && rubric.length > 0 ? rubric : RUBRIC_DIMENSIONS;
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

const { needs_review, review_reason } = computeNeedsReview(evaluation, durationSeconds, effectiveRubric);

await supabase.from("audits").update({
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
compliance_json: JSON.stringify({
...(evaluation.script_compliance ?? {}),
...(evaluation.call_reason ? { _call_reason: evaluation.call_reason } : {}),
}),
needs_review,
review_reason,
}).eq("id", auditId);

if (evaluation.overall_score < 5) {
const { sendLowScoreAlert } = await import("@/lib/alert");
sendLowScoreAlert({ auditId, agentName: agentName ?? "Unknown Agent", score: evaluation.overall_score, recommendations: evaluation.improvement_recommendations ?? [] }).catch(console.error);
}

if (audit.batch_id) {
import("@/lib/report").then(async ({ generateAndSendReport, istParts, parseEmails }) => {
  const { count } = await supabase.from("audits").select("id", { count: "exact", head: true }).eq("batch_id", audit.batch_id).in("status", ["transcribing", "scoring"]);
  if (count === 0) {
    const { data: settings } = await supabase.from("report_settings").select("emails, enabled, last_sent_date").eq("id", "default").maybeSingle();
    const { date } = istParts();
    if (settings?.enabled && settings?.emails) {
      const emails = parseEmails(settings.emails);
      if (emails.length > 0) await generateAndSendReport({ emails, istDate: date });
    }
  }
}).catch(console.error);
}

return { status: "completed" };
} catch (err) {
const message = err instanceof Error ? err.message : String(err);
await supabase.from("audits").update({ status: "failed", transcript: transcriptText, duration_seconds: durationSeconds, audited_at: new Date().toISOString(), error_message: `LLM scoring failed: ${message}` }).eq("id", auditId);
return { status: "failed" };
}
}
