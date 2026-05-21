import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { createAdminClient } from "@/lib/supabase/admin";
import { newBatchId, detectUrlColumn } from "@/lib/types/batch";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_URLS = 1000;
const INSERT_CHUNK = 500;

function newAuditId(): string {
  const d = new Date();
  const stamp = d
    .toISOString()
    .slice(0, 19)
    .replace(/[-:T]/g, "")
    .replace("T", "-");
  return `${stamp}-${Math.random().toString(16).slice(2, 8)}`;
}

export async function POST(req: Request) {
  try {
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return NextResponse.json(
        { error: "Expected multipart form data" },
        { status: 400 },
      );
    }

    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "No spreadsheet file received" },
        { status: 400 },
      );
    }

    const agentId = String(form.get("agent_id") ?? "").trim() || null;
    const preset = String(form.get("preset") ?? "general").trim() || "general";
    const strictness =
      String(form.get("strictness") ?? "standard").trim() || "standard";
    const customFocus = String(form.get("custom_focus") ?? "").trim();

    // Parse the sheet (xlsx auto-detects CSV vs XLSX from the buffer).
    let rows: Record<string, unknown>[];
    let headers: string[];
    try {
      const buf = Buffer.from(await file.arrayBuffer());
      const wb = XLSX.read(buf, { type: "buffer" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      if (!sheet) throw new Error("the file has no sheets");
      rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
        defval: "",
      });
      headers = rows.length > 0 ? Object.keys(rows[0]) : [];
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return NextResponse.json(
        { error: `Could not read the spreadsheet: ${message}` },
        { status: 422 },
      );
    }

    if (rows.length === 0) {
      return NextResponse.json(
        { error: "The spreadsheet has no data rows." },
        { status: 422 },
      );
    }

    const urlColumn = detectUrlColumn(headers);
    if (!urlColumn) {
      return NextResponse.json(
        {
          error:
            "Couldn't find a recording-URL column. Name a column something " +
            `like "recording_url" or "audio_url". Columns found: ${headers.join(", ")}`,
        },
        { status: 422 },
      );
    }

    // Extract + dedupe valid http(s) URLs from the detected column.
    const seen = new Set<string>();
    const urls: string[] = [];
    for (const row of rows) {
      const v = String(row[urlColumn] ?? "").trim();
      if (/^https?:\/\//i.test(v) && !seen.has(v)) {
        seen.add(v);
        urls.push(v);
      }
    }

    if (urls.length === 0) {
      return NextResponse.json(
        {
          error: `Column "${urlColumn}" was found but it has no valid http(s) URLs.`,
        },
        { status: 422 },
      );
    }
    if (urls.length > MAX_URLS) {
      return NextResponse.json(
        { error: `Too many recordings (${urls.length}). Max ${MAX_URLS} per batch.` },
        { status: 413 },
      );
    }

    let supabase;
    try {
      supabase = createAdminClient();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return NextResponse.json(
        { error: `${message}. Add it in Vercel and redeploy.` },
        { status: 500 },
      );
    }

    const batchId = newBatchId();
    const now = new Date().toISOString();

    const { error: batchErr } = await supabase.from("batches").insert({
      id: batchId,
      label: file.name,
      agent_id: agentId,
      preset,
      strictness,
      custom_focus: customFocus || null,
      url_column: urlColumn,
      total: urls.length,
      created_at: now,
    });
    if (batchErr) {
      return NextResponse.json(
        { error: `Could not create batch: ${batchErr.message}` },
        { status: 500 },
      );
    }

    // One queued audit per URL. Submission to AssemblyAI happens later, in
    // chunks, via /api/batches/[id]/process — keeps this request fast.
    const auditRows = urls.map((url) => ({
      id: newAuditId(),
      timestamp: now,
      source: "batch",
      target: url,
      preset,
      strictness,
      custom_focus: customFocus,
      agent_id: agentId,
      batch_id: batchId,
      status: "queued",
    }));

    for (let i = 0; i < auditRows.length; i += INSERT_CHUNK) {
      const chunk = auditRows.slice(i, i + INSERT_CHUNK);
      const { error: rowsErr } = await supabase.from("audits").insert(chunk);
      if (rowsErr) {
        return NextResponse.json(
          { error: `Batch created but rows failed: ${rowsErr.message}` },
          { status: 500 },
        );
      }
    }

    return NextResponse.json({
      id: batchId,
      total: urls.length,
      url_column: urlColumn,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[otis] /api/batches crashed:", message);
    return NextResponse.json(
      { error: `Unexpected server error: ${message}` },
      { status: 500 },
    );
  }
}
