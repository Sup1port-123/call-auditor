// web/app/api/karta-batch/route.ts
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { finalizeAudit } from "@/lib/finalize";

export const runtime = "nodejs";
export const maxDuration = 300;

type KartaRow = {
  callId: string;
  summary: string;
  phoneNumber?: string | null;
  durationMins?: number | null;
  disconnectedBy?: string | null;
  callStartStamp?: string | null;
};

type BatchRequest = {
  calls: KartaRow[];
  agentId?: string | null;
  preset?: string | null;
  strictness?: string | null;
  customFocus?: string | null;
  batchName?: string | null;
};

function newId(): string {
  const s = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, "");
  return `${s}-${Math.random().toString(16).slice(2, 8)}`;
}

const MIN_WORDS = 30;
const MIN_SECS = 60;

function wordCount(t: string): number {
  return t.trim().split(/\s+/).filter(Boolean).length;
}

export async function POST(req: Request) {
  let body: BatchRequest;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!Array.isArray(body.calls) || body.calls.length === 0) {
    return NextResponse.json({ error: "calls must be a non-empty array" }, { status: 400 });
  }

  const db = createAdminClient();
  const now = new Date().toISOString();

  const batchId = newId();
  await db.from("batches").insert({
    id: batchId,
    name: body.batchName ?? `Karta Import ${now.slice(0, 10)}`,
    agent_id: body.agentId ?? null,
    preset: body.preset ?? "general",
    strictness: body.strictness ?? "standard",
    custom_focus: body.customFocus ?? "",
    created_at: now,
  });

  const CONCURRENCY = 10;
  const results: { callId: string; auditId?: string; status: string }[] = [];

  async function processOne(call: KartaRow) {
    const summary = call.summary?.trim() ?? "";
    const durSecs =
      call.durationMins != null ? Math.round(call.durationMins * 60) : null;

    if (wordCount(summary) < MIN_WORDS) {
      return { callId: call.callId, status: "skipped_short_summary" };
    }
    if (durSecs !== null && durSecs < MIN_SECS) {
      return { callId: call.callId, status: "skipped_short_duration" };
    }

    const auditId = newId();

    const { error: insertErr } = await db.from("audits").insert({
      id: auditId,
      timestamp: call.callStartStamp ?? now,
      source: "karta_csv",
      target: `karta:${call.callId}`,
      call_id: call.callId,
      mobile_number: call.phoneNumber ?? null,
      preset: body.preset ?? "general",
      strictness: body.strictness ?? "standard",
      custom_focus: body.customFocus ?? "",
      agent_id: body.agentId ?? null,
      batch_id: batchId,
      status: "transcribing",
      transcript: summary,
      duration_seconds: durSecs,
      transcript_id: `deepgram_karta_${call.callId}`,
      disconnect_reason: call.disconnectedBy ?? null,
    });

    if (insertErr) {
      return { callId: call.callId, status: `insert_error: ${insertErr.message}` };
    }

    const { status } = await finalizeAudit(auditId);
    return { callId: call.callId, auditId, status };
  }

  for (let i = 0; i < body.calls.length; i += CONCURRENCY) {
    const chunk = body.calls.slice(i, i + CONCURRENCY);
    const chunkResults = await Promise.all(chunk.map(processOne));
    results.push(...chunkResults);
  }

  const completed = results.filter((r) => r.status === "completed").length;
  const failed = results.filter((r) => r.status === "failed").length;
  const skipped = results.filter((r) => r.status.startsWith("skipped")).length;

  return NextResponse.json({
    batchId,
    total: body.calls.length,
    completed,
    failed,
    skipped,
    results,
  });
}
