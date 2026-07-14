import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { newBatchId } from "@/lib/types/batch";

export const runtime = "nodejs";
export const maxDuration = 300;

const KARTA_BASE = "https://api.getkarta.ai";

type KartaCall = {
  call_id?: string;
  agent_id?: string;
  agent_name?: string;
  call_status?: string;
  recording_link?: string;
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

function newAuditId(): string {
  const stamp = new Date()
    .toISOString()
    .slice(0, 19)
    .replace(/[-:T]/g, "");
  return `${stamp}-${Math.random().toString(16).slice(2, 8)}`;
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const secret = process.env.CRON_SECRET;
    if (secret) {
      const viaVercel = req.headers.get("authorization") === `Bearer ${secret}`;
      const viaKey = url.searchParams.get("key") === secret;
      if (!viaVercel && !viaKey) {
        return NextResponse.json({ error: "unauthorized" }, { status: 401 });
      }
    }

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

    // Only ended calls with a valid recording URL
    const eligible = allCalls.filter(
      (c) =>
        String(c.call_status ?? "").toLowerCase() === "ended" &&
        c.recording_link &&
        /^https?:\/\//i.test(String(c.recording_link)),
    );
    console.log(`[otis] auto-ingest: ${eligible.length} eligible calls`);

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

      const batchId = newBatchId();
      const { error: batchErr } = await supabase.from("batches").insert({
        id: batchId,
        label: `Karta ${targetDate} — ${agentName}`,
        agent_id: otisAgentId,
        preset: "general",
        strictness: "standard",
        custom_focus: null,
        url_column: "recording_link",
        total: calls.length,
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

      const auditRows = calls.map((c) => ({
        id: newAuditId(),
        timestamp: now,
        source: "batch",
        target: String(c.recording_link),
        call_id: c.call_id ? String(c.call_id) : null,
        mobile_number: null,
        preset: "general",
        strictness: "standard",
        custom_focus: "",
        agent_id: otisAgentId,
        batch_id: batchId,
        status: "queued",
      }));

      let insertError: string | null = null;
      for (let i = 0; i < auditRows.length; i += 500) {
        const { error } = await supabase
          .from("audits")
          .insert(auditRows.slice(i, i + 500));
        if (error) {
          insertError = error.message;
          break;
        }
      }

      batchResults.push({
        karta_agent_id: kartaAgentId,
        agent_name: agentName,
        otis_agent_id: otisAgentId,
        call_count: calls.length,
        batch_id: insertError ? null : batchId,
        error: insertError,
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
