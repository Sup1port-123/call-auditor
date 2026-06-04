import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  parseAuditFilters,
  applyAuditFilters,
  formatDuration,
  type RawParams,
} from "@/lib/audit-filters";
import { parseScores, parseRecommendations } from "@/lib/types/audit";

export const runtime = "nodejs";
export const maxDuration = 60;

// Generous cap — the export reflects the full filtered set, not just the
// rows shown on the dashboard.
const EXPORT_CAP = 10000;

// Excel rejects cell text longer than 32,767 chars; keep a safety margin.
const CELL_MAX = 32000;

// "2026-06-03 17:57" in UTC. Excel-friendly and stable across machines.
function fmtDateTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 16).replace("T", " ");
}

function clip(s: string): string {
  return s.length > CELL_MAX ? `${s.slice(0, CELL_MAX)}…[truncated]` : s;
}

function reviewLabel(v: unknown): string {
  if (v === "reviewed") return "Reviewed";
  if (v === "flagged") return "Flagged";
  return "Not reviewed";
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const sp = Object.fromEntries(url.searchParams.entries()) as RawParams;
    const filters = parseAuditFilters(sp);

    const supabase = await createClient();
    // NOTE: keep this a single string literal — concatenating it with `+`
    // defeats supabase-js's compile-time column parsing and the row type
    // collapses to GenericStringError.
    const q = applyAuditFilters(
      supabase
        .from("audits")
        .select(
          "id, target, timestamp, audited_at, duration_seconds, overall_score, review_status, llm_provider, summary, scores_json, strengths, what_was_lacking, recommendations_json, transcript",
        ),
      filters,
    );

    const { data, error } = await q
      .order("timestamp", { ascending: false })
      .limit(EXPORT_CAP);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const rows = data ?? [];

    // Dimensions are per-agent, so the columns are the union of every
    // dimension that appears across the exported rows, in first-seen order.
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
      "Date of uploading",
      "Date of auditing",
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

      // One cell per dimension: "score/max — rationale".
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
      ]);
    });

    const XLSX = await import("xlsx");
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = [
      { wch: 56 }, // url
      { wch: 18 }, // uploaded
      { wch: 18 }, // audited
      { wch: 11 }, // score
      { wch: 14 }, // review status
      { wch: 10 }, // duration
      { wch: 14 }, // duration sec
      { wch: 50 }, // summary
      ...dimOrder.map(() => ({ wch: 44 })), // each dimension
      { wch: 50 }, // strengths
      { wch: 50 }, // what was lacking
      { wch: 50 }, // recommendations
      { wch: 80 }, // transcript
      { wch: 10 }, // llm
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Audits");
    const buf: Buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

    const stamp = new Date().toISOString().slice(0, 10);
    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="audits-${stamp}.xlsx"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[otis] export crashed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
