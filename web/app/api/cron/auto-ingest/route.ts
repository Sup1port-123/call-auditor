// web/app/api/cron/auto-ingest/route.ts
//
// Daily cron: fetch yesterday's Karta calls and score them using
// Karta's pre-generated conversation summaries (no AssemblyAI needed).
//
// Falls back to queuing calls with recording URLs if a call has no
// summary — those will remain "queued" until AssemblyAI is available.

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { finalizeAudit } from "@/lib/finalize";

export const runtime = "nodejs";
export const maxDuration = 300;

const KARTA_BASE = "https://api.getkarta.ai";

type KartaCall = {
  call_id?: string;
  agent_id?: string;
  agent_name?: string;
  call_status?: string;
  recording_link?: string;
  duration?: number;
  talk_time?: number;
  from_number?: string;
  caller_number?: string;
  phone_number?: string;
  customer_number?: string;
  // Summary fields (Karta provides these for ended calls)
  summary?: string;
  conversation_summary?: string;
  call_summary?: string;
  disconnectedBy?: string;
  disconnected_by?: string;
  call_start_stamp?: string;
  call_initiated_stamp?: string;
  [key: string]: unknown;
};

type KartaListResponse = {
  data?: KartaCall[];
  calls?: KartaCall[];
  items?: KartaCall[];
  results?: KartaCall[];
  total_pages?: number;
  has_more?: boolean;
};

async function fetchAllKartaCalls(
  apiKey: string,
  date: string,
): Promise<KartaCall[]> {
  const all: KartaCall[] = [];
  let page = 1;

  while (true) {
    const u = new URL(`${KARTA_BASE}/v1/calls`);
    u.searchParams.set("start_date", `${date}T00:00:00+05:30`);
    u.searchParams.set("end_date", `${date}T23:59:59+05:30`);
    u.searchParams.set("limit", "100");
    u.searchParams.set("page", String(page));

    const res = await fetch(u.toString(), {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Karta API error (${res.status}): ${body.slice(0, 300)}`);
    }

    const json = (await res.json()) as KartaListResponse;
    const calls = json.data ?? json.calls ?? json.items ?? json.results ?? [];
    if (calls.length === 0) break;
    all.push(...calls);

    if (
      json.has_more === false ||
      (json.total_pages != null && page >= json.total_pages) ||
      calls.length < 100
    )
      break;
    if (++page > 100) break;
  }

  return all;
}

function newId(): string {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, "");
  return `${stamp}-${Math.random().toString(16).slice(2, 8)}`;
}

function getSummary(c: KartaCall): string {
  return (
    String(c.summary ?? c.conversation_summary ?? c.call_summary ?? "").trim()
  );
}

function wordCount(t: string): number {
  return t.trim().split(/\s+/).filter(Boolean).length;
}

const MIN_DURATION_SECONDS = 60;
const MIN_SUMMARY_WORDS = 30;
const CONCURRENCY = 8;

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const apiKey = process.env.KARTA_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "KARTA_API_KEY env var is not set" },
        { status: 500 },
      );
    }

    // Yesterday in IST (or override via ?date=YYYY-MM-DD for testing)
    const IST_MS = 5.5 * 60 * 60 * 1000;
    const yesterday = new Date(Date.now() + IST_MS - 86_400_000);
    const defaultDate = yesterday.toISOString().slice(0, 10);
    const targetDate = url.searchParams.get("date") ?? defaultDate;

    console.log(`[otis] auto-ingest: fetching Karta calls for ${targetDate}`);

    const allCalls = await fetchAllKartaCalls(apiKey, targetDate);
    console.log(`[otis] auto-ingest: ${allCalls.length} total calls from Karta`);

    // Only ended calls that have a useful summary and meet min duration
    const eligible = allCalls.filter((c) => {
      if (String(c.call_status ?? "").toLowerCase() !== "ended") return false;
      const summary = getSummary(c);
      if (wordCount(summary) < MIN_SUMMARY_WORDS) return false;
      const dur = (c.talk_time ?? c.duration ?? null) as number | null;
      if (dur !== null && dur < MIN_DURATION_SECONDS) return false;
      return true;
    });

    console.log(`[otis] auto-ingest: ${eligible.length} eligible calls (with summaries)`);

    if (eligible.length === 0) {
      return NextResponse.json({
        date: targetDate,
        fetched: allCalls.length,
        eligible: 0,
        batches: [],
      });
    }

    // Group by Karta agent_id
    const byAgent = new Map<string, { name: string; calls: KartaCall[] }>();
    for (const c of eligible) {
      const key = String(c.agent_id ?? "").trim() || "__unknown__";
      const name = String(c.agent_name ?? "").trim() || "Unknown Agent";
      if (!byAgent.has(key)) byAgent.set(key, { name, calls: [] });
      byAgent.get(key)!.calls.push(c);
    }

    // Match Karta agent names to Otis agent IDs
    const supabase = createAdminClient();
    const { data: otisAgents } = await supabase
      .from("agents")
      .select("id, name");
    const nameToOtisId = new Map(
      (otisAgents ?? []).map((a) => [a.name.toLowerCase().trim(), a.id]),
    );

    const now = new Date().toISOString();
    const batchResults: object[] = [];

    for (const [kartaAgentId, { name: agentName, calls }] of byAgent) {
      const otisAgentId =
        nameToOtisId.get(agentName.toLowerCase().trim()) ?? null;

      // Dedup: skip calls already audited (by call_id or karta: target)
      const candidateCallIds = calls
        .filter((c) => c.call_id)
        .map((c) => String(c.call_id));
      const candidateTargets = calls.map(
        (c) => `karta:${c.call_id ?? c.recording_link ?? ""}`,
      );

      const { data: existingByCallId } = await supabase
        .from("audits")
        .select("call_id")
        .in("call_id", candidateCallIds);
      const alreadyAuditedIds = new Set(
        (existingByCallId ?? []).map((a: { call_id: string }) => a.call_id),
      );

      const { data: existingByTarget } = await supabase
        .from("audits")
        .select("target")
        .in("target", candidateTargets);
      const alreadyAuditedTargets = new Set(
        (existingByTarget ?? []).map((a: { target: string }) => a.target),
      );

      const newCalls = calls.filter((c) => {
        if (c.call_id && alreadyAuditedIds.has(String(c.call_id))) return false;
        const t = `karta:${c.call_id ?? c.recording_link ?? ""}`;
        if (alreadyAuditedTargets.has(t)) return false;
        return true;
      });

      if (newCalls.length === 0) {
        batchResults.push({
          karta_agent_id: kartaAgentId,
          agent_name: agentName,
          skipped: "all already audited",
        });
        continue;
      }

      // Create batch record with label (visible on batches page)
      const batchId = newId();
      const { error: batchErr } = await supabase.from("batches").insert({
        id: batchId,
        label: `Karta ${targetDate} — ${agentName}`,
        agent_id: otisAgentId,
        preset: "support",
        strictness: "standard",
        custom_focus: "",
        total: newCalls.length,
        created_at: now,
      });

      if (batchErr) {
        batchResults.push({
          karta_agent_id: kartaAgentId,
          agent_name: agentName,
          error: `batch insert: ${batchErr.message}`,
        });
        continue;
      }

      // Insert audit rows with transcript pre-stored, then score via finalizeAudit
      const scoreResults: { callId: string; status: string }[] = [];

      async function processOne(c: KartaCall) {
        const summary = getSummary(c);
        const callId = String(c.call_id ?? "");
        const durSecs =
          c.talk_time != null
            ? Math.round(Number(c.talk_time))
            : c.duration != null
              ? Math.round(Number(c.duration))
              : null;

        const auditId = newId();
        const { error: insertErr } = await supabase.from("audits").insert({
          id: auditId,
          timestamp: c.call_start_stamp ?? c.call_initiated_stamp ?? now,
          source: "karta_cron",
          target: `karta:${callId}`,
          call_id: callId || null,
          mobile_number:
            String(
              c.from_number ??
                c.caller_number ??
                c.phone_number ??
                c.customer_number ??
                "",
            ).trim() || null,
          preset: "support",
          strictness: "standard",
          custom_focus: "",
          agent_id: otisAgentId,
          batch_id: batchId,
          status: "transcribing",
          transcript: summary,
          duration_seconds: durSecs,
          // deepgram_ prefix tells finalize.ts to read transcript from DB column
          transcript_id: `deepgram_karta_${callId}`,
          disconnect_reason:
            String(c.disconnectedBy ?? c.disconnected_by ?? "").trim() || null,
        });

        if (insertErr) {
          return { callId, status: `insert_error: ${insertErr.message}` };
        }

        const { status } = await finalizeAudit(auditId);
        return { callId, status };
      }

      // Process in parallel batches
      for (let i = 0; i < newCalls.length; i += CONCURRENCY) {
        const chunk = newCalls.slice(i, i + CONCURRENCY);
        const results = await Promise.all(chunk.map(processOne));
        scoreResults.push(...results);
      }

      const completed = scoreResults.filter((r) => r.status === "completed").length;
      const failed = scoreResults.filter((r) => r.status === "failed").length;
      const errors = scoreResults.filter((r) =>
        r.status.startsWith("insert_error"),
      ).length;

      batchResults.push({
        karta_agent_id: kartaAgentId,
        agent_name: agentName,
        otis_agent_id: otisAgentId,
        call_count: newCalls.length,
        batch_id: batchId,
        completed,
        failed,
        errors,
      });
    }

    return NextResponse.json({
      date: targetDate,
      fetched: allCalls.length,
      eligible: eligible.length,
      batches: batchResults,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[otis] auto-ingest crashed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const POST = GET;
