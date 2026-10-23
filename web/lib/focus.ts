// web/lib/focus.ts
// ─────────────────────────────────────────────────────────────────────────────
// SPECIAL AUDIT FOCUS
// When a batch has an "Audit focus" (e.g. "Why are calls getting transferred?"),
// Otis returns a dedicated answer per call (focus_result) on top of the normal
// quality audit, and builds a batch-level Focus Report that groups the findings
// into reasons with counts, % share, agents affected, example calls, root-cause
// explanation and recommended fixes.
//
// Works for ANY question — presets give fixed categories for clean grouping;
// free-text questions let the AI create short category labels that are then
// grouped across the batch.
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
    : `Set "category" to a SHORT reason label (2-6 words, Title Case, generic enough to group with other calls — e.g. "Agent Knowledge Gap", "Customer Requested Senior"). Do not put call-specific details in the category.`;

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

/**
 * Builds the batch-level report. Counts / percentages / agent splits are
 * computed in code (always exact). The AI only writes the narrative —
 * headline, root cause per reason, fixes and recommendations.
 * Cost: ONE extra LLM call per batch.
 */
export async function buildFocusReport(
  question: string,
  rows: FocusAuditRow[],
): Promise<FocusReport> {
  const applicable = rows.filter((r) => r.focus.applicable);
  const groups = new Map<string, FocusAuditRow[]>();
  for (const r of applicable) {
    const k = r.focus.category || "Other";
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(r);
  }

  const sorted = [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
  const confRank = { high: 0, medium: 1, low: 2 } as const;

  const reasons: FocusReason[] = sorted.map(([category, list]) => {
    const scores = list.map((x) => x.overallScore).filter((s): s is number => typeof s === "number");
    const examples = [...list]
      .sort((a, b) => confRank[a.focus.confidence] - confRank[b.focus.confidence])
      .slice(0, 3)
      .map((x) => ({ auditId: x.auditId, callId: x.callId, finding: x.focus.finding, evidence: x.focus.evidence }));
    return {
      category,
      count: list.length,
      percent: applicable.length ? Math.round((list.length / applicable.length) * 1000) / 10 : 0,
      avgScore: scores.length ? Math.round((scores.reduce((s, v) => s + v, 0) / scores.length) * 10) / 10 : null,
      rootCause: "",
      fix: "",
      examples,
    };
  });

  // Agent breakdown
  const byAgent = new Map<string, FocusAuditRow[]>();
  for (const r of applicable) {
    const a = r.agentName || "Unknown agent";
    if (!byAgent.has(a)) byAgent.set(a, []);
    byAgent.get(a)!.push(r);
  }
  const agents = [...byAgent.entries()]
    .map(([agentName, list]) => {
      const c = new Map<string, number>();
      list.forEach((x) => c.set(x.focus.category, (c.get(x.focus.category) ?? 0) + 1));
      const top = [...c.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "—";
      return { agentName, applicable: list.length, topCategory: top };
    })
    .sort((a, b) => b.applicable - a.applicable);

  const report: FocusReport = {
    question,
    generatedAt: new Date().toISOString(),
    totalCalls: rows.length,
    applicableCalls: applicable.length,
    notApplicableCalls: rows.length - applicable.length,
    headline: "",
    keyInsight: "",
    reasons,
    agents,
    recommendations: [],
    lowConfidenceCalls: applicable.filter((r) => r.focus.confidence === "low").length,
  };

  if (applicable.length === 0) {
    report.headline = `None of the ${rows.length} audited calls matched the question.`;
    report.keyInsight = "The question did not apply to any call in this batch.";
    return report;
  }

  // ── Narrative via LLM (best-effort; numbers above stay exact even if this fails)
  const findingsDigest = sorted
    .map(([cat, list]) => {
      const lines = list.slice(0, 40).map((x) => `  - ${x.focus.finding}`).join("\n");
      return `REASON: ${cat} — ${list.length} calls (${Math.round((list.length / applicable.length) * 100)}%)\n${lines}`;
    })
    .join("\n\n")
    .slice(0, 60000);

  const prompt = `You are a senior call-centre quality analyst for GroMo (Indian fintech). An audit batch was run with this special question:
"${question}"

${applicable.length} of ${rows.length} calls were relevant. Below are the per-call findings grouped by reason (counts are exact — do not change them):

${findingsDigest}

Write a sharp, evidence-based report. Return VALID JSON ONLY:
{
  "headline": "<one sentence answering the question for the whole batch, citing the top reason and its %>",
  "key_insight": "<2-3 sentences on the real underlying root cause pattern across calls>",
  "reasons": { "<reason name exactly as given>": { "root_cause": "<1-2 sentences: WHY this keeps happening>", "fix": "<1 concrete action to reduce it>" } },
  "recommendations": ["<3-5 prioritised, specific actions for the team/training/process>"]
}`;

  try {
    const text = await callNarrativeLLM(prompt);
    const parsed = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, "").trim()) as {
      headline?: string;
      key_insight?: string;
      reasons?: Record<string, { root_cause?: string; fix?: string }>;
      recommendations?: string[];
    };
    report.headline = parsed.headline ?? "";
    report.keyInsight = parsed.key_insight ?? "";
    report.recommendations = Array.isArray(parsed.recommendations) ? parsed.recommendations : [];
    for (const r of report.reasons) {
      const n = parsed.reasons?.[r.category] ??
        Object.entries(parsed.reasons ?? {}).find(([k]) => k.toLowerCase() === r.category.toLowerCase())?.[1];
      r.rootCause = n?.root_cause ?? "";
      r.fix = n?.fix ?? "";
    }
  } catch (e) {
    console.error("[otis] focus report narrative failed:", e);
    const top = report.reasons[0];
    report.headline = `Top reason: ${top.category} — ${top.count} of ${applicable.length} calls (${top.percent}%).`;
  }

  return report;
}

async function callNarrativeLLM(prompt: string): Promise<string> {
  if (process.env.GOOGLE_API_KEY) {
    try {
      const { GoogleGenAI } = await import("@google/genai");
      const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY });
      const res = await ai.models.generateContent({
        model: process.env.GEMINI_MODEL || "gemini-2.5-flash",
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        config: { responseMimeType: "application/json", temperature: 0.3 },
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
        temperature: 0.3,
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
  const rows = r.reasons
    .map(
      (x, i) => `<tr style="background:${i % 2 ? "#ffffff" : "#f5f3ff"}">
  <td style="padding:8px;border:1px solid #e4e4e7;"><b>${esc(x.category)}</b></td>
  <td style="padding:8px;border:1px solid #e4e4e7;text-align:center;">${x.count}</td>
  <td style="padding:8px;border:1px solid #e4e4e7;text-align:center;"><b>${x.percent}%</b></td>
  <td style="padding:8px;border:1px solid #e4e4e7;">${esc(x.rootCause || "—")}</td>
  <td style="padding:8px;border:1px solid #e4e4e7;">${esc(x.fix || "—")}</td>
</tr>`,
    )
    .join("");

  const examples = r.reasons
    .slice(0, 3)
    .map(
      (x) => `<p style="margin:10px 0 4px;"><b>${esc(x.category)}</b></p>` +
        x.examples
          .map((e) => `<p style="margin:2px 0 2px 12px;font-size:12px;color:#3f3f46;">• ${e.callId ? `<b>Call ${esc(String(e.callId))}:</b> ` : ""}${esc(e.finding)}${e.evidence ? `<br><i style="color:#71717a;">“${esc(e.evidence)}”</i>` : ""}</p>`)
          .join(""),
    )
    .join("");

  const recs = r.recommendations.map((x) => `<li style="margin:4px 0;">${esc(x)}</li>`).join("");

  return `<div style="font-family:Arial,sans-serif;margin:20px 0;border:1px solid #ddd6fe;border-radius:10px;overflow:hidden;">
  <div style="background:#5b21b6;color:#fff;padding:14px 16px;">
    <div style="font-size:11px;letter-spacing:1px;opacity:.8;">SPECIAL AUDIT FOCUS REPORT</div>
    <div style="font-size:16px;font-weight:bold;margin-top:4px;">${esc(r.question)}</div>
  </div>
  <div style="padding:14px 16px;">
    <p style="font-size:15px;margin:0 0 8px;"><b>${esc(r.headline)}</b></p>
    <p style="margin:0 0 12px;color:#3f3f46;">${esc(r.keyInsight)}</p>
    <p style="font-size:12px;color:#71717a;margin:0 0 10px;">Relevant calls: <b>${r.applicableCalls}</b> of ${r.totalCalls} audited · Not applicable: ${r.notApplicableCalls}${r.lowConfidenceCalls ? ` · Low-confidence findings: ${r.lowConfidenceCalls}` : ""}</p>
    <table style="width:100%;border-collapse:collapse;font-size:13px;">
      <tr style="background:#1b2a4a;color:#fff;"><th style="padding:8px;text-align:left;">Reason</th><th style="padding:8px;">Calls</th><th style="padding:8px;">Share</th><th style="padding:8px;text-align:left;">Why it happens</th><th style="padding:8px;text-align:left;">Fix</th></tr>
      ${rows}
    </table>
    ${recs ? `<p style="margin:16px 0 4px;"><b>Recommended actions</b></p><ol style="margin:0;padding-left:20px;">${recs}</ol>` : ""}
    ${examples ? `<p style="margin:16px 0 4px;"><b>Example calls</b></p>${examples}` : ""}
  </div>
</div>`;
}
