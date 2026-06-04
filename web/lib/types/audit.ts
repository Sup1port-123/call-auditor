export type Audit = {
  id: string;
  timestamp: string;
  source: string;
  target: string;
  preset: string | null;
  strictness: string | null;
  custom_focus: string | null;
  llm_provider: string | null;
  llm_fallback_reason: string | null;
  overall_score: number | null;
  summary: string | null;
  scores_json: string | null;
  strengths: string | null;
  what_was_lacking: string | null;
  recommendations_json: string | null;
  transcript: string | null;
  duration_seconds: number | null;
  audited_at: string | null;
};

export type DimensionScore = {
  score: number | null;
  rationale?: string;
  evidence?: string[];
  // Snapshot of the rubric used when the audit ran (newer audits only).
  name?: string;
  min?: number;
  max?: number;
};

export type ParsedScores = Record<string, DimensionScore | number>;

export function parseScores(raw: string | null): ParsedScores {
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export function parseRecommendations(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}
