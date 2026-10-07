import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  RUBRIC_DIMENSIONS,
  SCRIPT_COMPLIANCE_CHECKS,
  INBOUND_COMPLIANCE_CHECKS,
  GRO_SCORE_COMPLIANCE_CHECKS,
} from "@/lib/rubric";

// Jev vs Otis comparison (experimental — lives on the jev-compare branch only).
// Takes an audit Otis has ALREADY scored, sends the same transcript to Jev through
// Vercel AI Gateway, and returns both sets of scores side by side.
// Nothing is written to the database.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const GATEWAY_URL = "https://ai-gateway.vercel.sh/v1/evaluate";
const JEV_MODEL = process.env.JEV_GATEWAY_MODEL || "typesafe-ai/jev";

// Jev scores on a ladder. We use 5 rungs and stretch them onto each
// dimension's own min–max range (1–5 for the default rubric, points for Gro-Score).
const LADDER = [
  "clear failure",
  "weak, major gaps",
  "adequate but unremarkable",
  "good",
  "excellent",
];

const CONTEXT =
  " This is a call between an AI sales/support agent and a customer in Indian fintech; the transcript may be in Hindi, English or Hinglish. Judge only the AGENT.";

type Dim = { score: number | null; name?: string; min?: number; max?: number; rationale?: string };

const CHECK_TEXT: Record<string, { name: string; instruction: string }> = {};
for (const c of [...SCRIPT_COMPLIANCE_CHECKS, ...INBOUND_COMPLIANCE_CHECKS, ...GRO_SCORE_COMPLIANCE_CHECKS]) {
  CHECK_TEXT[c.key] = { name: c.name, instruction: c.instruction };
}
const DIM_TEXT: Record<string, { name: string; criteria: string }> = {};
for (const d of RUBRIC_DIMENSIONS) DIM_TEXT[d.key] = { name: d.name, criteria: d.criteria };

function safeParse<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

// Recent audits that have a transcript, for the picker.
export async function GET() {
  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from("audits")
      .select("id, timestamp, target, llm_provider, overall_score")
      .not("transcript", "is", null)
      .not("scores_json", "is", null)
      .order("timestamp", { ascending: false })
      .limit(40);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ audits: data ?? [] });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as { id?: string };
    const id = (body.id || "").trim();
    if (!id) return NextResponse.json({ error: "Audit ID missing" }, { status: 400 });

    const token =
      process.env.AI_GATEWAY_API_KEY ||
      req.headers.get("x-vercel-oidc-token") ||
      process.env.VERCEL_OIDC_TOKEN;
    if (!token) {
      return NextResponse.json(
        { error: "No AI Gateway credentials found (AI_GATEWAY_API_KEY or Vercel OIDC token)." },
        { status: 500 },
      );
    }

    const supabase = createAdminClient();
    const { data: audit, error } = await supabase
      .from("audits")
      .select("id, timestamp, target, llm_provider, overall_score, summary, scores_json, compliance_json, transcript")
      .eq("id", id)
      .maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!audit) return NextResponse.json({ error: "Audit not found" }, { status: 404 });
    if (!audit.transcript) return NextResponse.json({ error: "This audit has no transcript" }, { status: 400 });

    const rawScores = safeParse<Record<string, Dim | number>>(audit.scores_json, {});
    const dims: { key: string; name: string; min: number; max: number; otis: number | null; rationale: string }[] = [];
    for (const [key, v] of Object.entries(rawScores)) {
      const d: Dim = typeof v === "number" ? { score: v } : v || { score: null };
      dims.push({
        key,
        name: d.name || DIM_TEXT[key]?.name || key,
        min: typeof d.min === "number" ? d.min : 1,
        max: typeof d.max === "number" ? d.max : 5,
        otis: typeof d.score === "number" ? d.score : null,
        rationale: d.rationale || "",
      });
    }
    if (!dims.length) return NextResponse.json({ error: "This audit has no dimension scores" }, { status: 400 });

    const rawChecks = safeParse<Record<string, { passed?: boolean; evidence?: string }>>(audit.compliance_json, {});
    const checks = Object.entries(rawChecks)
      .filter(([, v]) => v && typeof v === "object" && typeof v.passed === "boolean")
      .map(([key, v]) => ({
        key,
        name: CHECK_TEXT[key]?.name || key,
        instruction: CHECK_TEXT[key]?.instruction || `Did the agent satisfy this check: ${key.replace(/_/g, " ")}?`,
        otis: Boolean(v.passed),
        evidence: v.evidence || "",
      }));

    // Jev question keys must be simple, so index them.
    const questions: Record<string, unknown> = {};
    dims.forEach((d, i) => {
      questions[`d${i}`] = {
        type: "score",
        instructions: `${d.name}: ${DIM_TEXT[d.key]?.criteria || "Rate how well the agent did on this."}${CONTEXT}`,
        criteria: LADDER,
      };
    });
    checks.forEach((c, i) => {
      questions[`c${i}`] = { type: "boolean", instructions: c.instruction + CONTEXT };
    });

    const started = Date.now();
    const res = await fetch(GATEWAY_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: JEV_MODEL, state: audit.transcript, questions }),
    });
    const ms = Date.now() - started;
    const out = (await res.json().catch(() => null)) as {
      answers?: Record<string, { score?: number; probability?: number; probabilities?: Record<string, number> }>;
      usage?: { inputTokens?: number; outputTokens?: number };
      providerMetadata?: { gateway?: { cost?: string } };
      error?: { message?: string } | string;
      message?: string;
    } | null;
    if (!res.ok || !out?.answers) {
      const e = out?.error;
      const msg = (typeof e === "string" ? e : e?.message) || out?.message || `AI Gateway error ${res.status}`;
      return NextResponse.json({ error: `Jev: ${msg}` }, { status: 502 });
    }

    const round = (n: number) => Math.round(n * 10) / 10;
    const dimRows = dims.map((d, i) => {
      const a = out.answers![`d${i}`];
      const probs = Object.values(a?.probabilities || {}).map(Number);
      const jev = typeof a?.score === "number" ? round(d.min + (a.score / (LADDER.length - 1)) * (d.max - d.min)) : null;
      return {
        key: d.key,
        name: d.name,
        min: d.min,
        max: d.max,
        otis: d.otis,
        jev,
        confidence: probs.length ? Math.max(...probs) : null,
        rationale: d.rationale,
      };
    });
    const checkRows = checks.map((c, i) => {
      const p = out.answers![`c${i}`]?.probability;
      return {
        key: c.key,
        name: c.name,
        otis: c.otis,
        jev: typeof p === "number" ? p >= 0.5 : null,
        probability: typeof p === "number" ? p : null,
        evidence: c.evidence,
      };
    });

    // Percent score over the dimensions BOTH sides scored, so the totals are comparable.
    const both = dimRows.filter((r) => r.otis != null && r.jev != null);
    const maxSum = both.reduce((t, r) => t + r.max, 0);
    const pct = (pick: (r: (typeof both)[number]) => number) =>
      maxSum ? round((both.reduce((t, r) => t + pick(r), 0) / maxSum) * 100) : null;

    const cost = out.providerMetadata?.gateway?.cost;
    return NextResponse.json({
      audit: {
        id: audit.id,
        timestamp: audit.timestamp,
        target: audit.target,
        llm_provider: audit.llm_provider,
        summary: audit.summary,
      },
      otisPercent: pct((r) => r.otis as number),
      jevPercent: pct((r) => r.jev as number),
      dimensions: dimRows,
      checks: checkRows,
      jev: {
        model: JEV_MODEL,
        ms,
        costUsd: cost != null ? Number(cost) : null,
        inputTokens: out.usage?.inputTokens ?? null,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[otis] /api/jev-compare crashed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
