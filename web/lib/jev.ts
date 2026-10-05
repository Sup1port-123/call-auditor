// @ts-nocheck
// Jev (TypeSafe AI) — System One Model client for Otis
// Handles structured scoring: dimension scores + compliance checks
// Text fields (summary, strengths, etc.) are handled separately by an LLM
// API docs: https://typesafe.ai/blog/introducing-system-one-models-and-jev

export interface JevDimScore {
  score: number | null;
  confidence: number;
}

export interface JevComplianceResult {
  passed: boolean;
  probability: number;
}

export interface JevScoringResult {
  scores: Record<string, JevDimScore>;
  overall_score: number | null;
  compliance: Record<string, JevComplianceResult>;
}

export async function scoreWithJev(opts: {
  transcript: string;
  rubric: { key: string; name: string; min: number; max: number }[];
  complianceChecks: { key: string; name: string }[];
  agentName?: string | null;
  customFocus?: string | null;
}): Promise<JevScoringResult> {
  const apiKey = process.env.JEV_API_KEY;
  if (!apiKey) throw new Error("JEV_API_KEY is not set");

  // Build Jev questions map
  const questions: Record<string, unknown> = {};

  // Rubric dimension scores
  for (const d of opts.rubric) {
    questions[d.key] = { type: "score", min: d.min, max: d.max };
  }

  // Overall score (0-5 scale)
  questions["overall_score"] = { type: "score", min: 0, max: 5 };

  // Compliance checks — each as a Noul (probability the check passed)
  for (const c of opts.complianceChecks) {
    questions[`compliance_${c.key}`] = { type: "noul" };
  }

  // State: rubric context + optional focus + transcript
  const rubricLines = opts.rubric
    .map((d) => `- ${d.name} (${d.key}): score ${d.min}–${d.max}`)
    .join("\n");
  const focusLine = opts.customFocus ? `\nAudit Focus: ${opts.customFocus}` : "";
  const agentLine = opts.agentName ? `Agent: ${opts.agentName}` : "Agent: customer service";

  const state = [`${agentLine}${focusLine}`, `Scoring rubric:`, rubricLines, ``, `TRANSCRIPT:`, opts.transcript].join("\n");

  const res = await fetch("https://api.typesafe.ai/v1/systemone", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "jev-latest",
      state,
      questions,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Jev API error (${res.status}): ${body.slice(0, 300)}`);
  }

  const data = (await res.json()) as {
    decisions: Record<string, {
      value?: number | string;
      confidence?: number;
      probability?: number;
      probabilities?: Record<string, number>;
    }>;
  };

  const decisions = data.decisions ?? {};

  // Extract dimension scores
  const scores: Record<string, JevDimScore> = {};
  for (const d of opts.rubric) {
    const dec = decisions[d.key];
    const raw = dec?.value;
    scores[d.key] = {
      score: typeof raw === "number" ? Math.round(raw) : null,
      confidence: dec?.confidence ?? 0,
    };
  }

  // Extract overall score
  const overallDec = decisions["overall_score"];
  const rawOverall = overallDec?.value;
  const overall_score = typeof rawOverall === "number" ? Math.round(rawOverall * 10) / 10 : null;

  // Extract compliance results
  const compliance: Record<string, JevComplianceResult> = {};
  for (const c of opts.complianceChecks) {
    const dec = decisions[`compliance_${c.key}`];
    const prob = dec?.probability ?? (dec?.confidence ?? 0);
    compliance[c.key] = {
      passed: prob >= 0.5,
      probability: prob,
    };
  }

  return { scores, overall_score, compliance };
}
