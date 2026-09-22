// @ts-nocheck
// web/app/api/convozen-batch/route.ts
//
// Accepts TWO Convozen CSV export formats:
//
//  Format A — "call_details" (old):
//    Columns: callId, summary, callDuration (mins), phoneNumber, ...
//    Uses the AI-generated summary as transcript (lower quality)
//
//  Format B — "AI Call Logs" (new, preferred):
//    Columns: callId, chatHistory, callDuration, targetNumber, time, ...
//    Uses the full verbatim chat transcript (same quality as Karta audio audits)
//
// Auto-detects format from CSV headers.
// No audio / recording URL needed — skips AssemblyAI entirely.

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
    } else if (ch === "," && !inQuotes) {
      result.push(current); current = "";
    } else { current += ch; }
  }
  result.push(current);
  return result;
}

function parseCSV(text) {
  const lines = text.split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = parseCSVLine(lines[0]).map((h) => h.trim());
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

function detectFormat(headers) {
  if (headers.includes("chatHistory")) return "call_logs";
  if (headers.includes("summary"))     return "call_details";
  return "unknown";
}

function cleanChatHistory(raw) {
  let cleaned = raw.replace(/<session_metadata>[\s\S]*?<\/session_metadata>\s*/g, "");
  cleaned = cleaned
    .replace(/<\|HINDI\|>\s*/g, "")
    .replace(/<\|ENGLISH\|>\s*/g, "")
    .replace(/PATIENCE\s+[\d.]+\s*/g, "")
    .replace(/WAITING\s+[\d.]+\s*/g, "")
    .replace(/ENDCALL\s*/g, "")
    .replace(/TRANSFERCALL\s*/g, "");
  cleaned = cleaned.split("\n").map((l) => l.trim()).filter(Boolean).join("\n");
  return cleaned.trim();
}

function mapCallLogsRow(row) {
  const callId = row["callId"];
  const rawHistory = row["chatHistory"];
  if (!callId || !rawHistory) return null;
  const transcript = cleanChatHistory(rawHistory);
  if (!transcript) return null;
  const durSecs = row["callDuration"] && !isNaN(parseFloat(row["callDuration"]))
    ? Math.round(parseFloat(row["callDuration"])) : null;
  const phoneRaw = row["targetNumber"];
  const phoneNumber = phoneRaw && phoneRaw !== "null" ? String(phoneRaw) : null;
  const callStartStamp = row["time"] || row["created_at"] || null;
  const agentName = row["agentId"] || null;
  return { callId, transcript, phoneNumber, durationSecs: durSecs, callStartStamp, agentName, format: "call_logs" };
}

function mapCallDetailsRow(row) {
  const callId = row["callId"];
  let summary = row["summary"];
  if (!summary || summary.toLowerCase() === "null") {
    try { const ex = JSON.parse(row["extractedData"] || "{}"); summary = ex.summary || ""; } catch {}
  }
  if (!callId || !summary || summary.toLowerCase() === "null") return null;
  const durationRaw = row["callDuration (mins)"] || row["callDuration"];
  let durationSecs = null;
  if (durationRaw && !isNaN(parseFloat(durationRaw))) {
    durationSecs = row["callDuration (mins)"]
      ? Math.round(parseFloat(durationRaw) * 60)
      : Math.round(parseFloat(durationRaw));
  }
  const phoneRaw = row["phoneNumber"] || row["targetNumber"];
  const phoneNumber = phoneRaw && phoneRaw !== "Null" && phoneRaw !== "null" ? phoneRaw : null;
  const disconnectedBy = row["disconnectedBy"] || null;
  const callStartStamp = row["callStartStamp"] || row["createdAt"] || row["time"] || null;
  const agentName = row["agentName"] || null;
  return { callId, transcript: summary, phoneNumber, durationSecs, disconnectedBy, callStartStamp, agentName, format: "call_details" };
        }

const MIN_WORDS = 30;
const MIN_SECS  = 60;
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
  if (rawRows.length === 0) return NextResponse.json({ error: "CSV is empty or could not be parsed." }, { status: 400 });

  const headers = Object.keys(rawRows[0]);
  const format = detectFormat(headers);
  if (format === "unknown") {
    return NextResponse.json({
      error: "Unrecognised CSV format. Expected 'chatHistory' (AI Call Logs) or 'summary' (call_details) column.",
    }, { status: 400 });
  }

  const mapper = format === "call_logs" ? mapCallLogsRow : mapCallDetailsRow;
  const calls = rawRows.map(mapper).filter(Boolean);
  if (calls.length === 0) {
    return NextResponse.json({
      error: "No valid calls found (format: " + format + ").",
    }, { status: 400 });
  }

  const agentId     = formData.get("agentId")     || null;
  const preset      = formData.get("preset")      || "general";
  const strictness  = formData.get("strictness")  || "standard";
  const customFocus = formData.get("customFocus") || "";
  const batchLabel  = format === "call_logs" ? "Chat Logs" : "Summary";
  const batchName   = formData.get("batchName") || ("Convozen Import " + new Date().toISOString().slice(0, 10) + " (" + batchLabel + ")");

  const db  = createAdminClient();
  const now = new Date().toISOString();
  const batchId = newId();
  await db.from("batches").insert({ id: batchId, name: batchName, agent_id: agentId, preset, strictness, custom_focus: customFocus, created_at: now });

  const CONCURRENCY = 10;
  const results = [];

  async function processOne(call) {
    const transcript = call.transcript.trim();
    const durSecs    = call.durationSecs;
    if (wordCount(transcript) < MIN_WORDS) return { callId: call.callId, status: "skipped_short_transcript" };
    if (durSecs !== null && durSecs < MIN_SECS) return { callId: call.callId, status: "skipped_short_duration" };
    const auditId = newId();
    const { error: insertErr } = await db.from("audits").insert({
      id: auditId, timestamp: call.callStartStamp ?? now,
      source: "convozen_" + format, target: "convozen:" + call.callId,
      call_id: call.callId, mobile_number: call.phoneNumber ?? null,
      preset, strictness, custom_focus: customFocus, agent_id: agentId, batch_id: batchId,
      status: "transcribing", transcript, duration_seconds: durSecs,
      transcript_id: "deepgram_convozen_" + call.callId,
      disconnect_reason: call.disconnectedBy ?? null,
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

  const completed = results.filter((r) => r.status === "completed").length;
  const failed    = results.filter((r) => r.status === "failed").length;
  const skipped   = results.filter((r) => r.status.startsWith("skipped")).length;

  return NextResponse.json({ batchId, format, total: calls.length, completed, failed, skipped, results });
          }
