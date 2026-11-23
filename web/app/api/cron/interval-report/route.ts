import { NextResponse } from "next/server";
import { generateAndSendReport, INTERVAL_REPORT_RECIPIENTS } from "@/lib/report";
import { checkQualityDrop } from "@/lib/alerts";

export const runtime = "nodejs";
export const maxDuration = 60;

const HOURS = Number(process.env.INTERVAL_REPORT_HOURS ?? 3);

function istLabel(ms: number): string {
  return new Date(ms + 5.5 * 3600_000).toISOString().slice(0, 16).replace("T", " ");
}

// One combined audit report for the audits finished in the last few hours
// (default 3), instead of an email for every batch. The Apps Script trigger
// `reportNow` calls this every 3 hours:
//   GET /api/cron/interval-report?key=YOUR_CRON_SECRET
// Nothing is sent when no audit finished in the window.
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const secret = process.env.CRON_SECRET;
    const authorized =
      !!secret &&
      (url.searchParams.get("key") === secret ||
        req.headers.get("authorization") === `Bearer ${secret}`);
    if (!authorized) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    const emails = INTERVAL_REPORT_RECIPIENTS;
    if (emails.length === 0) return NextResponse.json({ skipped: "no recipients" });

    const toMs = Date.now();
    const fromMs = toMs - HOURS * 3600_000;
    const { inboundCount, outboundCount } = await generateAndSendReport({
      emails,
      istDate: new Date(toMs + 5.5 * 3600_000).toISOString().slice(0, 10),
      range: {
        gte: new Date(fromMs).toISOString(),
        lte: new Date(toMs).toISOString(),
        label: `${istLabel(fromMs)} to ${istLabel(toMs).slice(11)} IST`,
      },
      skipIfEmpty: true,
    });
    const quality = await checkQualityDrop(fromMs, toMs).catch((e) => ({ error: String(e) }));
    return NextResponse.json({ sent: inboundCount + outboundCount > 0, inboundCount, outboundCount, hours: HOURS, quality });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[otis] interval-report crashed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const POST = GET;
