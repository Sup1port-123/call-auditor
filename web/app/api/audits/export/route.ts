import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  parseAuditFilters,
  applyAuditFilters,
  type RawParams,
} from "@/lib/audit-filters";
import { buildAuditsXlsx, AUDIT_EXPORT_COLUMNS } from "@/lib/audit-export";

export const runtime = "nodejs";
export const maxDuration = 60;

// Generous cap — the export reflects the full filtered set, not just the
// rows shown on the dashboard.
const EXPORT_CAP = 10000;

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const sp = Object.fromEntries(url.searchParams.entries()) as RawParams;
    const filters = parseAuditFilters(sp);

    const supabase = await createClient();
    const q = applyAuditFilters(
      supabase.from("audits").select(AUDIT_EXPORT_COLUMNS),
      filters,
    );

    const { data, error } = await q
      .order("timestamp", { ascending: false })
      .limit(EXPORT_CAP);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const buf = await buildAuditsXlsx(data ?? []);
    const stamp = new Date().toISOString().slice(0, 10);
    // Re-wrap so the body type is Uint8Array<ArrayBuffer> (a valid BodyInit);
    // the builder's return type widens to Uint8Array<ArrayBufferLike>.
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
