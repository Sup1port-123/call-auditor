// web/app/api/convozen-batch/route.ts
// Accepts a Convozen CSV export and audits calls using pre-generated summaries.
// No audio / recording URL needed -- skips AssemblyAI entirely.
// POST /api/convozen-batch  Body: multipart/form-data  file=CSV, agentId?, preset?, strictness?, customFocus?, batchName?

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { finalizeAudit } from "@/lib/finalize";

export const runtime = "nodejs";
export const maxDuration = 300;

function parseCSVLine(line) {
  const result = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else { inQuotes = !inQuotes; }
    } else if (ch === "," && !inQuotes) { result.push(current); current = ""; }
    else { current += ch; }
  }
  result.push(current);
  return result;
}

function parseCSV(text) {
  const lines = text.split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = parseCSVLine(lines[0]).map(h => h.trim());
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const values = parseCSVLine(line);
    const row = {};
    headers.forEach((h, idx) => { row[h] = (values[idx] ?? "").trim(); });
    rows.push(row);
  }
  return rows;
}

function mapConvozenRow(row) {
  const callId = row["callId"];
  const summary = row["summary"];
  if (!callId || !summary || summary.toLowerCase() === "null") return null;
  const durationRaw = row["callDuration (mins)"];
  const durationMins = durationRaw && !isNaN(parseFloat(durationRaw)) ? parseFloat(durationRaw) : null;
  const phoneRaw = row["phoneNumber"];
  const phoneNumber = phoneRaw && phoneRaw !== "Null" && phoneRaw !== "null" ? phoneRaw : null;
  const disconnectedBy = row["disconnectedBy"] || null;
  const callStartStamp = row["callStartStamp"] || row["createdAt"] || null;
  const agentName = row["agentName"] || null;
  return { callId, summary, phoneNumber, durationMins, disconnectedBy, callStartStamp, agentName };
}

const MIN_WORDS = 30;
const MIN_SECS = 60;
function wordCount(t) { return t.trim().split(/\s+/).filter(Boolean).length; }
function newId() {
  const s = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, "");
  return s + "-" + Math.random().toString(16).slice(2, 8);
}

export async function POST(req) {
  let formData;
  try { formData = await req.formData(); }
  catch { return NextResponse.json({ error: "Expected multipart/form-data" }, { status: 400 }); }

  const file = formData.get("file");
  if (!file) return NextResponse.json({ error: "No file uploaded." }, { status: 400 });

  const csvText = await file.text();
  const rawRows = parseCSV(csvText);
  if (rawRows.length === 0) return NextResponse.json({ error: "CSV is empty." }, { status: 400 });

  const agentId = formData.get("agentId") || null;
  const preset = formData.get("preset") || "general";
  const strictness = formData.get("strictness") || "standard";
  const customFocus = formData.get("customFocus") || "";
  const batchName = formData.get("batchName") || ("Convozen Import " + new Date().toISOString().slice(0, 10));

  const calls = rawRows.map(mapConvozenRow).filter(Boolean);
  if (calls.length === 0) return NextResponse.json({ error: "No valid calls found in CSV." }, { status: 400 });

  const db = createAdminClient();
  const now = new Date().toISOString();
  const batchId = newId();

  await db.from("batches").insert({ id: batchId, name: batchName, agent_id: agentId, preset, strictness, custom_focus: customFocus, created_at: now });

  const CONCURRENCY = 10;
  const results = [];

  async function processOne(call) {
    const summary = call.summary.trim();
    const durSecs = call.durationMins != null ? Math.round(call.durationMins * 60) : null;
    if (wordCount(summary) < MIN_WORDS) return { callId: call.callId, status: "skipped_short_summary" };
    if (durSecs !== null && durSecs < MIN_SECS) return { callId: call.callId, status: "skipped_short_duration" };
    const auditId = newId();
    const { error: insertErr } = await db.from("audits").insert({
      id: auditId, timestamp: call.callStartStamp ?? now, source: "convozen_csv",
      target: "convozen:" + call.callId, call_id: call.callId, mobile_number: call.phoneNumber ?? null,
      preset, strictness, custom_focus: customFocus, agent_id: agentId, batch_id: batchId,
      status: "transcribing", transcript: summary, duration_seconds: durSecs,
      transcript_id: "deepgram_convozen_" + call.callId, disconnect_reason: call.disconnectedBy ?? null,
    });
    if (insertErr) return { callId: call.callId, status: "insert_error: " + insertErr.message };
    const { status } = await finalizeAudit(auditId);
    return { callId: call.callId, auditId, status };
  }

  for (let i = 0; i < calls.length; i += CONCURRENCY) {
    const chunk = calls.slice(i, i + CONCURRENCY);
    const chunkResults = await Promise.all(chunk.map(processOne));
    results.push(...chunkResults);
  }

  const completed = results.filter(r => r.status === "completed").length;
  const failed = results.filter(r => r.status === "failed").length;
  const skipped = results.filter(r => r.status.startsWith("skipped")).length;

  return NextResponse.json({ batchId, total: calls.length, completed, failed, skipped, results });
    }
