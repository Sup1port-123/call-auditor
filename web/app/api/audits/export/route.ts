import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  parseAuditFilters,
  applyAuditFilters,
  formatDuration,
  type RawParams,
} from "@/lib/audit-filters";

export const runtime = "nodejs";
export const maxDuration = 60;

// Generous cap — the export reflects the full filtered set, not just the
// rows shown on the dashboard.
const EXPORT_CAP = 10000;

// "2026-06-03 17:57" in UTC. Excel-friendly and stable across machines.
function fmtDateTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 16).replace("T", " ");
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const sp = Object.fromEntries(url.searchParams.entries()) as RawParams;
    const filters = parseAuditFilters(sp);

    const supabase = await createClient();
    const q = applyAuditFilters(
      supabase
        .from("audits")
        .select(
          "id, target, timestamp, audited_at, duration_seconds, overall_score, llm_provider",
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

    const header = [
      "Recording URL",
      "Date of uploading",
      "Date of auditing",
      "Duration",
      "Duration (sec)",
      "Audit score",
      "LLM",
    ];

    const aoa: (string | number)[][] = [header];
    for (const r of rows) {
      const hasDur =
        r.duration_seconds != null && r.duration_seconds >= 0;
      aoa.push([
        r.target ?? "",
        fmtDateTime(r.timestamp),
        // Fall back to the upload time for old audits with no audited_at.
        fmtDateTime(r.audited_at ?? r.timestamp),
        hasDur ? formatDuration(r.duration_seconds) : "",
        hasDur ? r.duration_seconds : "",
        r.overall_score ?? "",
        r.llm_provider ?? "",
      ]);
    }

    const XLSX = await import("xlsx");
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = [
      { wch: 60 },
      { wch: 18 },
      { wch: 18 },
      { wch: 10 },
      { wch: 14 },
      { wch: 11 },
      { wch: 10 },
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
