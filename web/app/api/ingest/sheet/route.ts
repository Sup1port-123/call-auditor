import { NextResponse, after } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { newBatchId } from "@/lib/types/batch";
import {
  MIN_SECONDS,
  MIN_WORDS,
  toIso,
  toSeconds,
  transcriptFor,
  wordCount,
  type SheetRow,
} from "@/lib/sheet-ingest";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_ROWS = 500;
// How long to keep driving the new batches after answering the sync script.
const DRIVE_BUDGET_MS = 45_000;

function newAuditId(): string {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, "");
  return `${stamp}-${Math.random().toString(16).slice(2, 8)}`;
}

type Body = {
  source?: "karta" | "convozen";
  label?: string;
  default_agent?: string;
  preset?: string;
  strictness?: string;
  rows?: SheetRow[];
};

// Receives new calls from a Google Sheet (via the Apps Script in
// web/integrations/google-sheets) and audits them: one batch per agent, so the
// batch page and the batch-complete email (with the Excel attached) work as
// for an upload. Secured by CRON_SECRET, passed as ?key= or a Bearer token.
export async function POST(req: Request) {
  const url = new URL(req.url);
  const secret = process.env.CRON_SECRET;
  const authorized =
    !!secret &&
    (url.searchParams.get("key") === secret ||
      req.headers.get("authorization") === `Bearer ${secret}`);
  if (!authorized) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const source = body.source === "convozen" ? "convozen" : "karta";
  const rows = Array.isArray(body.rows) ? body.rows : [];
  if (rows.length === 0) return NextResponse.json({ error: "rows must be a non-empty array" }, { status: 400 });
  if (rows.length > MAX_ROWS) {
    return NextResponse.json({ error: `Too many rows (${rows.length}); send at most ${MAX_ROWS} per request.` }, { status: 413 });
  }

  const db = createAdminClient();
  const now = new Date().toISOString();
  const preset = body.preset || "general";
  const strictness = body.strictness || "standard";
  const label = (body.label || `${source === "karta" ? "Karta" : "Convozen"} sheet ${now.slice(0, 10)}`).trim();

  // Skip calls Otis already has, whatever their status.
  const ids = [...new Set(rows.map((r) => String(r.call_id ?? "").trim()).filter(Boolean))];
  const known = new Set<string>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await db.from("audits").select("call_id").in("call_id", ids.slice(i, i + 200));
    if (error) return NextResponse.json({ error: `Could not check existing audits: ${error.message}` }, { status: 500 });
    for (const a of data ?? []) if (a.call_id) known.add(a.call_id as string);
  }

  const { data: agents } = await db.from("agents").select("id, name");
  const agentIdFor = (name: string) =>
    (agents ?? []).find((a) => a.name.toLowerCase().trim() === name.toLowerCase().trim())?.id ?? null;

  const skipped = { duplicate: 0, too_short: 0, no_content: 0 };
  type Prepared = { row: SheetRow; transcript: string | null; seconds: number | null; recording: string | null };
  const byAgent = new Map<string, Prepared[]>();
  const seenNow = new Set<string>();
  for (const row of rows) {
    const callId = String(row.call_id ?? "").trim();
    if (callId && (known.has(callId) || seenNow.has(callId))) { skipped.duplicate++; continue; }
    const seconds = toSeconds(row.duration_seconds);
    if (seconds !== null && seconds < MIN_SECONDS) { skipped.too_short++; continue; }
    const transcript = transcriptFor(row, source);
    const recording = /^https?:\/\//i.test(String(row.recording_url ?? "").trim())
      ? String(row.recording_url).trim().replace(/\s+/g, "")
      : null;
    if (transcript ? wordCount(transcript) < MIN_WORDS : !recording) { skipped.no_content++; continue; }
    if (callId) seenNow.add(callId);
    const agentName = (row.agent_name ?? body.default_agent ?? "").trim() || "No agent";
    if (!byAgent.has(agentName)) byAgent.set(agentName, []);
    byAgent.get(agentName)!.push({ row, transcript, seconds, recording });
  }

  const batches: { id: string; label: string; agent: string; total: number }[] = [];
  for (const [agentName, items] of byAgent) {
    const batchId = newBatchId();
    const batchLabel = `${label} — ${agentName}`;
    const { error: batchErr } = await db.from("batches").insert({
      id: batchId, label: batchLabel, agent_id: agentName === "No agent" ? null : agentIdFor(agentName),
      preset, strictness, custom_focus: null, url_column: null, total: items.length, created_at: now,
    });
    if (batchErr) return NextResponse.json({ error: `Could not create batch: ${batchErr.message}` }, { status: 500 });
    const agentId = agentName === "No agent" ? null : agentIdFor(agentName);
    const auditRows = items.map(({ row, transcript, seconds, recording }) => {
      const id = newAuditId();
      const callId = String(row.call_id ?? "").trim() || null;
      return {
        id,
        timestamp: toIso(row.call_time, now),
        // Same source values the dashboard / weekly report already use per vendor.
        source: source === "convozen" ? "convozen_call_details" : "batch",
        target: recording ?? `${source}:${callId ?? id}`,
        call_id: callId,
        mobile_number: row.mobile ? String(row.mobile).trim() : null,
        disconnect_reason: row.disconnect_reason ? String(row.disconnect_reason).trim() : null,
        preset, strictness, custom_focus: "", agent_id: agentId, batch_id: batchId,
        // With text the audit goes straight to scoring; with only a recording
        // it waits in the queue for transcription.
        ...(transcript
          ? { status: "transcribing", transcript, transcript_id: `upload_${id}`, duration_seconds: seconds }
          : { status: "queued", duration_seconds: seconds }),
      };
    });
    for (let i = 0; i < auditRows.length; i += 500) {
      const { error } = await db.from("audits").insert(auditRows.slice(i, i + 500));
      if (error) return NextResponse.json({ error: `Batch ${batchId} created but rows failed: ${error.message}` }, { status: 500 });
    }
    batches.push({ id: batchId, label: batchLabel, agent: agentName, total: items.length });
  }

  // Start scoring right away; the process-batches cron finishes anything left.
  if (batches.length > 0) {
    const prod = process.env.VERCEL_PROJECT_PRODUCTION_URL;
    const base = prod ? `https://${prod}` : url.origin;
    const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
    after(async () => {
      const started = Date.now();
      let progressed = true;
      while (progressed && Date.now() - started < DRIVE_BUDGET_MS) {
        progressed = false;
        for (const b of batches) {
          if (Date.now() - started >= DRIVE_BUDGET_MS) break;
          try {
            const res = await fetch(`${base}/api/batches/${b.id}/process`, {
              method: "POST",
              headers: bypass ? { "x-vercel-protection-bypass": bypass } : undefined,
              signal: AbortSignal.timeout(Math.max(1000, DRIVE_BUDGET_MS - (Date.now() - started))),
            });
            const out = (await res.json().catch(() => ({}))) as { submitted?: number; finalized?: number };
            if ((out.submitted ?? 0) > 0 || (out.finalized ?? 0) > 0) progressed = true;
          } catch (err) {
            console.error(`[otis] sheet ingest: processing ${b.id} failed:`, err);
          }
        }
      }
    });
  }

  return NextResponse.json({
    received: rows.length,
    audited: batches.reduce((n, b) => n + b.total, 0),
    skipped,
    batches,
  });
}
