// web/lib/focus.ts
// ─────────────────────────────────────────────────────────────────────────────
// SPECIAL AUDIT FOCUS
// When a batch has an "Audit focus" (e.g. "Why are calls getting transferred?"),
// Otis returns a dedicated answer per call (focus_result) on top of the normal
// quality audit, and builds a batch-level Focus Report:
//   Reason | Calls | Share  (similar reasons merged, 1-call reasons grouped as "Other")
// plus root cause, fix, example calls and recommended actions.
// ─────────────────────────────────────────────────────────────────────────────

import { FOCUS_PRESETS, type FocusPreset } from "./focus-presets";
export { FOCUS_PRESETS, type FocusPreset };

export type FocusConfidence = "high" | "medium" | "low";

export type FocusResult = {
  question: string;
  /** false when the question does not apply to this call (e.g. no transfer happened) */
  applicable: boolean;
  /** 1-2 sentence direct answer for THIS call */
  finding: string;
  /** short reason label used for grouping across the batch */
  category: string;
  /** verbatim quote with [MM:SS] timestamp proving the finding */
  evidence: string;
  confidence: FocusConfidence;
};

/** Match a focus text to a preset (by exact question, label or key). */
export function getFocusPreset(customFocus?: string | null): FocusPreset | null {
  const f = (customFocus ?? "").trim().toLowerCase();
  if (!f) return null;
  return (
    FOCUS_PRESETS.find(
      (p) =>
        p.question.toLowerCase() === f ||
        p.label.toLowerCase() === f ||
        p.key === f,
    ) ?? null
  );
}

export function hasFocus(customFocus?: string | null): boolean {
  return !!customFocus && customFocus.trim().length > 0;
}

/** Instructions injected into the system prompt when a focus is set. */
export function buildFocusPromptBlock(customFocus: string): string {
  const preset = getFocusPreset(customFocus);
  const question = preset ? preset.question : customFocus.trim();
  const catLine = preset
    ? `Choose "category" from EXACTLY one of: ${preset.categories.map((c) => `"${c}"`).join(", ")}.`
    : `Set "category" to a SHORT, plain-English reason in sentence case (2-6 words, generic enough to group with other calls — e.g. "Customer asked for a senior", "Customer asked for a callback", "Payout query delayed"). Do not put call-specific details in the category.`;

  return `SPECIAL AUDIT QUESTION (answer separately in "focus_result"):
"${question}"
- Answer this question for THIS call only, based strictly on the transcript. Do not guess.
- If the question does not apply to this call (e.g. asked about transfers but no transfer happened), set applicable=false, category="Not applicable", and explain briefly in finding.
- "finding": 1-2 sentences giving the direct, specific answer and the root cause (the real WHY, not just what happened).
- ${catLine}
- "evidence": a verbatim quote from the transcript with its [MM:SS] timestamp that proves the finding.
- "confidence": "high" if clearly stated in the transcript, "medium" if strongly implied, "low" if inferred.
This special question does NOT change the quality scoring rules — still score the rubric normally.`;
}

/** JSON-shape snippet appended to the prompt's response format. */
export function focusJsonShape(): string {
  return `,\n  "focus_result": { "applicable": <true|false>, "finding": "<string>", "category": "<string>", "evidence": "<quote with [MM:SS]>", "confidence": "<high|medium|low>" }`;
}

/** Clean up whatever the LLM returned into a safe FocusResult. */
export function normalizeFocusResult(
  raw: unknown,
  customFocus?: string | null,
): FocusResult | undefined {
  if (!hasFocus(customFocus)) return undefined;
  const preset = getFocusPreset(customFocus);
  const question = preset ? preset.question : customFocus!.trim();
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;

  const applicable = r.applicable !== false;
  let category = typeof r.category === "string" && r.category.trim() ? r.category.trim() : "Other";
  if (!applicable) category = "Not applicable";
  // Snap to preset category when the model drifted slightly
  if (preset && applicable) {
    const hit = preset.categories.find((c) => c.toLowerCase() === category.toLowerCase());
    category = hit ?? "Other";
  }
  const conf = String(r.confidence ?? "medium").toLowerCase();

  return {
    question,
    applicable,
    finding: typeof r.finding === "string" ? r.finding.trim() : "",
    category,
    evidence: typeof r.evidence === "string" ? r.evidence.trim() : "",
    confidence: conf === "high" || conf === "low" ? (conf as FocusConfidence) : "medium",
  };
}

/** Read focus_result back from compliance_json (stored under `_focus_result`). */
export function parseFocusFromCompliance(complianceJson: string | null | undefined): FocusResult | null {
  if (!complianceJson) return null;
  try {
    const obj = JSON.parse(complianceJson) as Record<string, unknown>;
    const f = obj?._focus_result as FocusResult | undefined;
    return f && typeof f === "object" && "category" in f ? f : null;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// BATCH FOCUS REPORT
// ─────────────────────────────────────────────────────────────────────────────

export type FocusAuditRow = {
  auditId: string;
  callId?: string | null;
  mobile?: string | null;
  agentName?: string | null;
  overallScore?: number | null;
  focus: FocusResult;
};

export type FocusReason = {
  category: string;
  count: number;
  percent: number; // share of applicable calls
  avgScore: number | null;
  /** original per-call reason names merged into this one */
  includes?: string[];
  /** AI-written root cause explanation for this reason */
  rootCause: string;
  /** AI-written fix for this reason */
  fix: string;
  examples: { auditId: string; callId?: string | null; finding: string; evidence: string }[];
};

export type FocusReport = {
  question: string;
  generatedAt: string;
  totalCalls: number;
  applicableCalls: number;
  notApplicableCalls: number;
  headline: string;
  keyInsight: string;
  reasons: FocusReason[];
  agents: { agentName: string; applicable: number; topCategory: string }[];
  recommendations: string[];
  lowConfidenceCalls: number;
};

export type ReasonTableRow = { label: string; count: number; percent: number; isOther: boolean };

/**
 * The summary table shown on Otis and in the email:
 *   Reason | Calls | Share
 * Reasons with only 1 call are folded into one "Other, 1 call each: …" row
 * (only when there are 2 or more of them).
 */
export function summarizeReasons(reasons: FocusReason[]): ReasonTableRow[] {
  const singles = reasons.filter((r) => r.count === 1);
  if (singles.length < 2) {
    return reasons.map((r) => ({ label: r.category, count: r.count, percent: r.percent, isOther: false }));
  }
  const main = reasons
    .filter((r) => r.count > 1)
    .map((r) => ({ label: r.category, count: r.count, percent: r.percent, isOther: false }));
  const lower = (s: string) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);
  const otherPct = Math.round(singles.reduce((s, r) => s + r.percent, 0) * 10) / 10;
  main.push({
    label: `Other, 1 call each: ${singles.map((r) => lower(r.category)).join(", ")}`,
    count: singles.length,
    percent: otherPct,
    isOther: true,
  });
  return main;
}

function groupBy<T>(items: T[], key: (t: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const it of items) {
    const k = key(it);
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(it);
  }
  return m;
}

/**
 * Builds the batch-level report.
 * ONE extra LLM call per batch: it merges near-duplicate reasons (for free-text
 * questions) and writes the narrative. Counts / percentages / headline are
 * always computed in code so the numbers are exact.
 */
export async function buildFocusReport(
  question: string,
  rows: FocusAuditRow[],
): Promise<FocusReport> {
  const applicable = rows.filter((r) => r.focus.applicable);
  const base = {
    question,
    generatedAt: new Date().toISOString(),
    totalCalls: rows.length,
    applicableCalls: applicable.length,
    notApplicableCalls: rows.length - applicable.length,
    lowConfidenceCalls: applicable.filter((r) => r.focus.confidence === "low").length,
  };

  if (applicable.length === 0) {
    return {
      ...base,
      headline: `None of the ${rows.length} audited calls matched the question.`,
      keyInsight: "The question did not apply to any call in this batch.",
      reasons: [],
      agents: [],
      recommendations: [],
    };
  }

  // 1. Raw groups by the per-call reason
  const rawGroups = groupBy(applicable, (r) => r.focus.category || "Other");
  const rawSorted = [...rawGroups.entries()].sort((a, b) => b[1].length - a[1].length);
  const isPreset = !!getFocusPreset(question);

  const digest = rawSorted
    .map(([cat, list]) => {
      const lines = list.slice(0, 25).map((x) => `  - ${x.focus.finding}`).join("\n");
      return `REASON: ${cat} (${list.length} calls)\n${lines}`;
    })
    .join("\n\n")
    .slice(0, 60000);

  const mergeRule = isPreset
    ? `The reasons come from a fixed list — do NOT merge or rename them. merge_map must map every reason to itself.`
    : `First MERGE reasons that mean the same thing into ONE clear reason name in plain-English sentence case (e.g. "Customer requested senior", "Customer requested human agent" and "Customer requested transfer" → "Customer asked for a senior"; "Escalation required" and "Escalation for further investigation" → "Escalation needed"). Merge aggressively: if two reasons would be fixed by the same action, they are ONE reason. Any request by the customer to speak to someone else (senior, supervisor, human agent, real person, customer service, another team, "transfer me") MUST be merged into one reason "Customer asked for a senior". Aim for 3-6 merged reasons in total. Keep reasons separate only when the fix is genuinely different. Every original reason must appear exactly once as a key in merge_map.`;

  const prompt = `You are a senior call-centre quality analyst for GroMo (Indian fintech). An audit batch was run with this special question:
"${question}"

Per-call findings grouped by the reason each call was tagged with:

${digest}

${mergeRule}

Then write a sharp, evidence-based analysis for the MERGED reasons. Do not write any numbers or percentages — the system adds exact counts itself.

Return VALID JSON ONLY:
{
  "merge_map": { "<original reason exactly as given>": "<merged reason name>" },
  "key_insight": "<2-3 sentences on the real underlying root-cause pattern across calls (no numbers)>",
  "reasons": { "<merged reason name>": { "root_cause": "<1-2 sentences: WHY this keeps happening>", "fix": "<1 concrete action to reduce it>" } },
  "recommendations": ["<3-5 prioritised, specific actions for the team/training/process>"]
}`;

  type Narrative = {
    merge_map?: Record<string, string>;
    key_insight?: string;
    reasons?: Record<string, { root_cause?: string; fix?: string }>;
    recommendations?: string[];
  };
  let parsed: Narrative = {};
  try {
    const text = await callNarrativeLLM(prompt);
    parsed = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, "").trim()) as Narrative;
  } catch (e) {
    console.error("[otis] focus report narrative failed:", e);
  }

  // 2. Apply merge map (case-insensitive), then regroup with exact counts
  const mm = new Map<string, string>();
  for (const [k, val] of Object.entries(parsed.merge_map ?? {})) {
    if (typeof val === "string" && val.trim()) mm.set(k.trim().toLowerCase(), val.trim());
  }
  const mergedOf = (cat: string) => mm.get(cat.trim().toLowerCase()) ?? cat;

  const groups = groupBy(applicable, (r) => mergedOf(r.focus.category || "Other"));
  const sorted = [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
  const confRank = { high: 0, medium: 1, low: 2 } as const;
  const lookup = (name: string) =>
    parsed.reasons?.[name] ??
    Object.entries(parsed.reasons ?? {}).find(([k]) => k.toLowerCase() === name.toLowerCase())?.[1];

  const reasons: FocusReason[] = sorted.map(([category, list]) => {
    const scores = list.map((x) => x.overallScore).filter((s): s is number => typeof s === "number");
    const examples = [...list]
      .sort((a, b) => confRank[a.focus.confidence] - confRank[b.focus.confidence])
      .slice(0, 3)
      .map((x) => ({ auditId: x.auditId, callId: x.callId, finding: x.focus.finding, evidence: x.focus.evidence }));
    const n = lookup(category);
    return {
      category,
      count: list.length,
      percent: Math.round((list.length / applicable.length) * 1000) / 10,
      avgScore: scores.length ? Math.round((scores.reduce((s, v) => s + v, 0) / scores.length) * 10) / 10 : null,
      includes: [...new Set(list.map((x) => x.focus.category))],
      rootCause: n?.root_cause ?? "",
      fix: n?.fix ?? "",
      examples,
    };
  });

  // Agent breakdown (on merged reasons)
  const agents = [...groupBy(applicable, (r) => r.agentName || "Unknown agent").entries()]
    .map(([agentName, list]) => {
      const c = new Map<string, number>();
      list.forEach((x) => {
        const k = mergedOf(x.focus.category);
        c.set(k, (c.get(k) ?? 0) + 1);
      });
      const top = [...c.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "—";
      return { agentName, applicable: list.length, topCategory: top };
    })
    .sort((a, b) => b.applicable - a.applicable);

  const top = reasons[0];
  const headline = `${applicable.length} of ${rows.length} calls matched. Top reason: ${top.category} — ${top.count} calls (${top.percent}%).`;

  return {
    ...base,
    headline,
    keyInsight: parsed.key_insight ?? "",
    reasons,
    agents,
    recommendations: Array.isArray(parsed.recommendations) ? parsed.recommendations : [],
  };
}

async function callNarrativeLLM(prompt: string): Promise<string> {
  if (process.env.GOOGLE_API_KEY) {
    try {
      const { GoogleGenAI } = await import("@google/genai");
      const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY });
      const res = await ai.models.generateContent({
        model: process.env.GEMINI_MODEL || "gemini-2.5-flash",
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        config: { responseMimeType: "application/json", temperature: 0.2 },
      });
      if (res.text) return res.text;
    } catch (e) {
      console.error("[otis] focus narrative Gemini failed:", e);
    }
  }
  if (process.env.OPENAI_API_KEY) {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-4o-mini",
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (res.ok) {
      const d = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      const t = d.choices?.[0]?.message?.content;
      if (t) return t;
    }
  }
  throw new Error("No LLM available for focus report narrative");
}

// ─────────────────────────────────────────────────────────────────────────────
// EMAIL HTML (used in the batch completion email)
// ─────────────────────────────────────────────────────────────────────────────

function esc(s: string): string {
  return (s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function renderFocusReportHtml(r: FocusReport): string {
  const table = summarizeReasons(r.reasons)
    .map(
      (x, i) => `<tr style="background:${i % 2 ? "#ffffff" : "#f5f3ff"}">
  <td style="padding:8px;border:1px solid #e4e4e7;">${x.isOther ? esc(x.label) : `<b>${esc(x.label)}</b>`}</td>
  <td style="padding:8px;border:1px solid #e4e4e7;text-align:center;">${x.count}</td>
  <td style="padding:8px;border:1px solid #e4e4e7;text-align:center;"><b>${x.percent}%</b></td>
</tr>`,
    )
    .join("");

  const why = r.reasons
    .filter((x) => x.count > 1 && (x.rootCause || x.fix))
    .map(
      (x) => `<p style="margin:8px 0 2px;"><b>${esc(x.category)}</b></p>` +
        (x.rootCause ? `<p style="margin:0 0 2px 12px;font-size:13px;color:#3f3f46;">Why: ${esc(x.rootCause)}</p>` : "") +
        (x.fix ? `<p style="margin:0 0 2px 12px;font-size:13px;color:#047857;">Fix: ${esc(x.fix)}</p>` : ""),
    )
    .join("");

  const recs = r.recommendations.map((x) => `<li style="margin:4px 0;">${esc(x)}</li>`).join("");

  return `<div style="font-family:Arial,sans-serif;margin:20px 0;border:1px solid #ddd6fe;border-radius:10px;overflow:hidden;background:#fff;">
  <div style="background:#5b21b6;color:#fff;padding:14px 16px;">
    <div style="font-size:11px;letter-spacing:1px;opacity:.8;">SPECIAL AUDIT FOCUS REPORT</div>
    <div style="font-size:16px;font-weight:bold;margin-top:4px;">${esc(r.question)}</div>
  </div>
  <div style="padding:14px 16px;">
    <p style="font-size:15px;margin:0 0 8px;"><b>${esc(r.headline)}</b></p>
    ${r.keyInsight ? `<p style="margin:0 0 12px;color:#3f3f46;">${esc(r.keyInsight)}</p>` : ""}
    <table style="width:100%;border-collapse:collapse;font-size:13px;">
      <tr style="background:#1b2a4a;color:#fff;"><th style="padding:8px;text-align:left;">Reason</th><th style="padding:8px;width:70px;">Calls</th><th style="padding:8px;width:80px;">Share</th></tr>
      ${table}
    </table>
    <p style="font-size:11px;color:#71717a;margin:6px 0 0;">Share = % of the ${r.applicableCalls} relevant calls · Not applicable: ${r.notApplicableCalls}</p>
    ${why ? `<p style="margin:16px 0 4px;"><b>Why it happens &amp; how to fix</b></p>${why}` : ""}
    ${recs ? `<p style="margin:16px 0 4px;"><b>Recommended actions</b></p><ol style="margin:0;padding-left:20px;">${recs}</ol>` : ""}
  </div>
</div>`;
}
