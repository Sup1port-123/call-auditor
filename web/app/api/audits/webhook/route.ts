import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchFormattedTranscript, scoreTranscript } from "@/lib/auditor";

export const runtime = "nodejs";
export const maxDuration = 60;

// AssemblyAI webhook lands here when transcription is done. We identify the
// audit via the x-audit-id header we set at submission time. On completion
// we fetch the formatted transcript, run LLM scoring, then write the
// finished evaluation into the audits row.

export async function POST(req: Request) {
  const auditId = req.headers.get("x-audit-id");
  if (!auditId) {
    return NextResponse.json(
      { error: "Missing x-audit-id header" },
      { status: 401 },
    );
  }

  let body: { transcript_id?: string; status?: string; error?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const supabase = createAdminClient();

  if (body.status !== "completed") {
    const message = body.error || `transcription status: ${body.status}`;
    await supabase
      .from("audits")
      .update({ status: "failed", error_message: message })
      .eq("id", auditId);
    return NextResponse.json({ ok: true, status: body.status });
  }

  if (!body.transcript_id) {
    return NextResponse.json(
      { error: "Webhook missing transcript_id" },
      { status: 400 },
    );
  }

  await supabase.from("audits").update({ status: "scoring" }).eq("id", auditId);

  let transcriptText = "";
  try {
    const { text } = await fetchFormattedTranscript(body.transcript_id);
    transcriptText = text;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await supabase
      .from("audits")
      .update({
        status: "failed",
        error_message: `Transcript fetch failed: ${message}`,
      })
      .eq("id", auditId);
    return NextResponse.json({ ok: false, error: message }, { status: 200 });
  }

  const { data: row } = await supabase
    .from("audits")
    .select("preset, strictness, custom_focus")
    .eq("id", auditId)
    .maybeSingle();

  try {
    const evaluation = await scoreTranscript({
      transcript: transcriptText,
      preset: row?.preset ?? undefined,
      strictness: row?.strictness ?? undefined,
      customFocus: row?.custom_focus ?? undefined,
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
    return NextResponse.json({ ok: false, error: message }, { status: 200 });
  }

  return NextResponse.json({ ok: true });
}
