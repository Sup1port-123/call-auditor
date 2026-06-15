import { formatDuration } from "./audit-filters";
import { parseScores, parseRecommendations } from "./types/audit";
import { istStamp } from "./datetime";

// Single string literal — concatenating with `+` defeats supabase-js's
// compile-time column parsing (the row type collapses to GenericStringError).
export const AUDIT_EXPORT_COLUMNS =
  "id, target, timestamp, audited_at, duration_seconds, overall_score, review_status, llm_provider, summary, scores_json, strengths, what_was_lacking, recommendations_json, transcript";

export type AuditExportRow = {
  target: string | null;
  timestamp: string | null;
  audited_at: string | null;
  duration_seconds: number | null;
  overall_score: number | null;
  review_status: string | null;
  llm_provider: string | null;
  summary: string | null;
  scores_json: string | null;
  strengths: string | null;
  what_was_lacking: string | null;
  recommendations_json: string | null;
  transcript: string | null;
};

// Excel rejects cell text longer than 32,767 chars; keep a safety margin.
const CELL_MAX = 32000;

// IST, sortable — e.g. "2026-06-15 16:00".
function fmtDateTime(iso: string | null): string {
  return istStamp(iso);
}

function clip(s: string): string {
  return s.length > CELL_MAX ? `${s.slice(0, CELL_MAX)}…[truncated]` : s;
}

function reviewLabel(v: unknown): string {
  if (v === "reviewed") return "Reviewed";
  if (v === "flagged") return "Flagged";
  return "Not reviewed";
}

// Build the exact .xlsx the dashboard download produces, from a set of audit
// rows. Shared by the export route and the scheduled email report so they stay
// byte-for-byte identical.
export async function buildAuditsXlsx(
  rows: readonly AuditExportRow[],
): Promise<Uint8Array> {
  // Dimensions are per-agent, so the columns are the union of every dimension
  // that appears across the exported rows, in first-seen order.
  const dimOrder: string[] = [];
  const dimMeta = new Map<string, { name: string; max: number }>();
  const parsedScores = rows.map((r) => parseScores(r.scores_json));
  for (const scores of parsedScores) {
    for (const [key, val] of Object.entries(scores)) {
      if (dimMeta.has(key)) continue;
      dimOrder.push(key);
      const obj = typeof val === "object" && val != null ? val : null;
      dimMeta.set(key, {
        name: obj?.name ? obj.name : key.replace(/_/g, " "),
        max: typeof obj?.max === "number" ? obj.max : 5,
      });
    }
  }

  const header = [
    "Recording URL",
    "Date of uploading (IST)",
    "Date of auditing (IST)",
    "Audit score",
    "Review status",
    "Duration",
    "Duration (sec)",
    "Summary",
    ...dimOrder.map((k) => dimMeta.get(k)!.name),
    "Strengths",
    "What was lacking",
    "Recommendations",
    "Transcript",
    "LLM",
  ];

  const aoa: (string | number)[][] = [header];

  rows.forEach((r, i) => {
    const scores = parsedScores[i];
    const hasDur = r.duration_seconds != null && r.duration_seconds >= 0;

    const dimCells = dimOrder.map((key) => {
      const v = scores[key];
      if (v == null) return "";
      const sc = typeof v === "number" ? v : v.score;
      const rationale = typeof v === "number" ? "" : v.rationale ?? "";
      const max = dimMeta.get(key)!.max;
      if (sc == null) return rationale ? `— ${rationale}` : "";
      return rationale ? `${sc}/${max} — ${rationale}` : `${sc}/${max}`;
    });

    const recs = parseRecommendations(r.recommendations_json)
      .map((x, n) => `${n + 1}. ${x}`)
      .join("\n");

    aoa.push([
      r.target ?? "",
      fmtDateTime(r.timestamp),
      fmtDateTime(r.audited_at ?? r.timestamp),
      r.overall_score ?? "",
      reviewLabel(r.review_status),
      hasDur ? formatDuration(r.duration_seconds) : "",
      hasDur ? r.duration_seconds : "",
      clip(r.summary ?? ""),
      ...dimCells.map(clip),
      clip(r.strengths ?? ""),
      clip(r.what_was_lacking ?? ""),
      clip(recs),
      clip(r.transcript ?? ""),
      r.llm_provider ?? "",
    ] as (string | number)[]);
  });

  const XLSX = await import("xlsx");
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [
    { wch: 56 },
    { wch: 18 },
    { wch: 18 },
    { wch: 11 },
    { wch: 14 },
    { wch: 10 },
    { wch: 14 },
    { wch: 50 },
    ...dimOrder.map(() => ({ wch: 44 })),
    { wch: 50 },
    { wch: 50 },
    { wch: 50 },
    { wch: 80 },
    { wch: 10 },
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Audits");
  const buf: Buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  return new Uint8Array(buf);
}
