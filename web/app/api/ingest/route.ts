import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 60;

// Auto-ingestion entry point. Your call platform (or a small adapter / poller)
// POSTs normalized calls here; we dedupe, route each to the right agent, and
// queue them. /api/cron/process-queue then transcribes + scores them with no
// human step.
//
// Auth: pass the shared secret as ?key=INGEST_SECRET or header x-ingest-key.
//
// Body (any of these shapes):
//   { "calls": [ {call}, {call}, ... ] }
//   [ {call}, {call} ]
//   {call}
//
// A {call} is:
//   {
//     "recording_url":    "https://..."    (required, http/https)
//     "external_call_id": "platform-id"    (required — dedup key)
//     "agent_key":        "inbound_v2"     (optional — matched to agents.external_keys)
//     "agent_id":         "agt-..."        (optional — direct, overrides agent_key)
//     "preset":           "general"        (optional)
//     "strictness":       "standard"       (optional)
//     "custom_focus":     "..."            (optional)
//     "timestamp":        "2026-06-11T..." (optional — defaults to now)
//   }

type RawCall = {
  recording_url?: string;
  external_call_id?: string | number;
  agent_key?: string;
  agent_id?: string;
  preset?: string;
  strictness?: string;
  custom_focus?: string;
  timestamp?: string;
};

function newAuditId(): string {
  const d = new Date();
  const stamp = d.toISOString().slice(0, 19).replace(/[-:T]/g, "");
  return `${stamp}-${Math.random().toString(16).slice(2, 8)}`;
}

function authorized(req: Request): boolean {
  const secret = process.env.INGEST_SECRET;
  if (!secret) return false;
  const url = new URL(req.url);
  const key = url.searchParams.get("key") ?? req.headers.get("x-ingest-key");
  return key === secret;
}

export async function POST(req: Request) {
  try {
    if (!authorized(req)) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const body = await req.json().catch(() => null);
    const calls: RawCall[] = Array.isArray(body)
      ? body
      : Array.isArray(body?.calls)
      ? body.calls
      : body && typeof body === "object"
      ? [body]
      : [];

    if (calls.length === 0) {
      return NextResponse.json(
        { error: "No calls in payload" },
        { status: 400 },
      );
    }
    if (calls.length > 1000) {
      return NextResponse.json(
        { error: "Max 1000 calls per request" },
        { status: 400 },
      );
    }

    const supabase = createAdminClient();

    // Build the source-id → agent-id map once.
    const { data: agents } = await supabase
      .from("agents")
      .select("id, external_keys");
    const agentByKey = new Map<string, string>();
    for (const a of agents ?? []) {
      for (const k of String(a.external_keys ?? "")
        .split(/[,\s]+/)
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean)) {
        if (!agentByKey.has(k)) agentByKey.set(k, a.id);
      }
    }

    const now = new Date().toISOString();
    const rows: Record<string, unknown>[] = [];
    const errors: { external_call_id?: string; error: string }[] = [];

    for (const c of calls) {
      const url = String(c.recording_url ?? "").trim();
      const extId = String(c.external_call_id ?? "").trim();
      if (!url || !/^https?:\/\//i.test(url)) {
        errors.push({ external_call_id: extId, error: "bad recording_url" });
        continue;
      }
      if (!extId) {
        errors.push({ error: "missing external_call_id" });
        continue;
      }
      const agentId =
        (c.agent_id && String(c.agent_id)) ||
        (c.agent_key && agentByKey.get(String(c.agent_key).trim().toLowerCase())) ||
        null;

      rows.push({
        id: newAuditId(),
        timestamp: c.timestamp ? String(c.timestamp) : now,
        source: "ingest",
        target: url,
        external_call_id: extId,
        agent_id: agentId,
        preset: c.preset || "general",
        strictness: c.strictness || "standard",
        custom_focus: c.custom_focus || "",
        status: "queued",
      });
    }

    let created = 0;
    if (rows.length > 0) {
      // ignoreDuplicates: rows whose external_call_id already exists are
      // skipped (the unique index makes this atomic).
      const { data, error } = await supabase
        .from("audits")
        .upsert(rows, {
          onConflict: "external_call_id",
          ignoreDuplicates: true,
        })
        .select("id");
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      created = data?.length ?? 0;
    }

    return NextResponse.json({
      received: calls.length,
      created,
      skipped_duplicates: rows.length - created,
      invalid: errors.length,
      errors: errors.slice(0, 20),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[otis] /api/ingest crashed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
