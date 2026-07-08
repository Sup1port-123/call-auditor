import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { newBatchId } from "@/lib/types/batch";

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

type BatchRow = {
  url: string;
  call_id: string | null;
  mobile: string | null;
};

type BatchBody = {
  filename?: string;
  url_column?: string;
  rows?: unknown;   // new format: [{url, call_id, mobile}]
  urls?: unknown;   // legacy format: string[]
  agent_id?: string | null;
  preset?: string;
  strictness?: string;
  custom_focus?: string;
};

export async function POST(req: Request) {
  try {
    let body: BatchBody;
    try {
      body = (await req.json()) as BatchBody;
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const filename = String(body.filename ?? "").trim() || null;
    const urlColumn = String(body.url_column ?? "").trim() || null;
    const agentId = String(body.agent_id ?? "").trim() || null;
    const preset = String(body.preset ?? "general").trim() || "general";
    const strictness =
      String(body.strictness ?? "standard").trim() || "standard";
    const customFocus = String(body.custom_focus ?? "").trim();

    // Support both new rows format and legacy urls array
    let inputRows: BatchRow[] = [];
    if (Array.isArray(body.rows)) {
      for (const r of body.rows as unknown[]) {
        if (r && typeof r === "object" && "url" in r) {
          const row = r as { url?: unknown; call_id?: unknown; mobile?: unknown };
          const url = typeof row.url === "string" ? row.url.trim() : "";
          inputRows.push({
            url,
            call_id: typeof row.call_id === "string" ? row.call_id.trim() || null : null,
            mobile: typeof row.mobile === "string" ? row.mobile.trim() || null : null,
          });
        }
      }
    } else if (Array.isArray(body.urls)) {
      for (const u of body.urls as unknown[]) {
        const url = typeof u === "string" ? u.trim() : "";
        inputRows.push({ url, call_id: null, mobile: null });
      }
    } else {
      return NextResponse.json(
        { error: "rows (or urls) must be an array" },
        { status: 400 },
      );
    }

    // Filter + dedupe
    const seen = new Set<string>();
    const validRows: BatchRow[] = [];
    for (const r of inputRows) {
      if (/^https?:\/\//i.test(r.url) && !seen.has(r.url)) {
        seen.add(r.url);
        validRows.push(r);
      }
    }

    if (validRows.length === 0) {
      return NextResponse.json(
        { error: "No valid http(s) URLs in the upload." },
        { status: 400 },
      );
    }
    if (validRows.length > MAX_URLS) {
      return NextResponse.json(
        { error: `Too many recordings (${validRows.length}). Max ${MAX_URLS}.` },
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
      label: filename,
      agent_id: agentId,
      preset,
      strictness,
      custom_focus: customFocus || null,
      url_column: urlColumn,
      total: validRows.length,
      created_at: now,
    });
    if (batchErr) {
      return NextResponse.json(
        { error: `Could not create batch: ${batchErr.message}` },
        { status: 500 },
      );
    }

    const auditRows = validRows.map((r) => ({
      id: newAuditId(),
      timestamp: now,
      source: "batch",
      target: r.url,
      call_id: r.call_id,
      mobile_number: r.mobile,
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
      total: validRows.length,
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
