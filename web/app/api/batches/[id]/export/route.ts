import { createClient } from "@/lib/supabase/server";
import { RUBRIC_DIMENSIONS } from "@/lib/rubric";
import { parseScores, parseRecommendations } from "@/lib/types/audit";

export const runtime = "nodejs";

function csvCell(v: unknown): string {
  const s = v == null ? "" : String(v);
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: audits, error } = await supabase
    .from("audits")
    .select("*")
    .eq("batch_id", id)
    .order("timestamp", { ascending: true });

  if (error) {
    return new Response(`Could not load batch: ${error.message}`, {
      status: 500,
    });
  }

  const dimKeys = RUBRIC_DIMENSIONS.map((d) => d.key);
  const header = [
    "recording_url",
    "status",
    "overall_score",
    ...dimKeys,
    "summary",
    "strengths",
    "what_was_lacking",
    "recommendations",
    "llm_provider",
    "error_message",
  ];

  const lines = [header.map(csvCell).join(",")];

  for (const a of audits ?? []) {
    const scores = parseScores(a.scores_json);
    const recs = parseRecommendations(a.recommendations_json);
    const dimValues = dimKeys.map((k) => {
      const v = scores[k];
      if (v == null) return "";
      return typeof v === "number" ? v : (v.score ?? "");
    });
    const row = [
      a.target,
      a.status ?? "",
      a.overall_score ?? "",
      ...dimValues,
      a.summary ?? "",
      a.strengths ?? "",
      a.what_was_lacking ?? "",
      recs.join(" | "),
      a.llm_provider ?? "",
      a.error_message ?? "",
    ];
    lines.push(row.map(csvCell).join(","));
  }

  const csv = lines.join("\r\n");
  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="otis-batch-${id}.csv"`,
    },
  });
}
