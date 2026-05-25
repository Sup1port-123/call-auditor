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

type BatchBody = {
  filename?: string;
  url_column?: string;
  urls?: unknown;
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

    if (!Array.isArray(body.urls)) {
      return NextResponse.json(
        { error: "urls must be an array" },
        { status: 400 },
      );
    }

    // Filter + dedupe defensively, in case the client mis-parsed.
    const seen = new Set<string>();
    const urls: string[] = [];
    for (const u of body.urls as unknown[]) {
      const s = typeof u === "string" ? u.trim() : "";
      if (/^https?:\/\//i.test(s) && !seen.has(s)) {
        seen.add(s);
        urls.push(s);
      }
    }
    if (urls.length === 0) {
      return NextResponse.json(
        { error: "No valid http(s) URLs in the upload." },
        { status: 400 },
      );
    }
    if (urls.length > MAX_URLS) {
      return NextResponse.json(
        { error: `Too many recordings (${urls.length}). Max ${MAX_URLS}.` },
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
      total: urls.length,
      created_at: now,
    });
    if (batchErr) {
      return NextResponse.json(
        { error: `Could not create batch: ${batchErr.message}` },
        { status: 500 },
      );
    }

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
