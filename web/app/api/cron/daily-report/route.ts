import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { DAILY_REPORT_RECIPIENTS, generateAndSendReport, istParts } from "@/lib/report";

export const runtime = "nodejs";
export const maxDuration = 60;

// One report a day, sent in the morning (09:00 IST) for the PREVIOUS IST day.
// The Apps Script trigger `dailyReportNow` calls it:
//   GET /api/cron/daily-report?key=YOUR_CRON_SECRET
// It sends once per IST day. Add &force=1 to send again.
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const force = url.searchParams.get("force") === "1";
    const secret = process.env.CRON_SECRET;
    const authorized =
      !!secret &&
      (url.searchParams.get("key") === secret ||
        req.headers.get("authorization") === `Bearer ${secret}`);
    if (!authorized) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    const emails = DAILY_REPORT_RECIPIENTS;
    if (emails.length === 0) return NextResponse.json({ skipped: "no recipients" });

    const supabase = createAdminClient();
    const { date } = istParts();
    if (!force) {
      // Two schedulers can call this (Vercel cron and the Apps Script trigger), so
      // make sure the day's report goes out only once. `last_sent_date` is used when
      // that column exists; `updated_at` (always there) is the fallback.
      const { data: settings } = await supabase
        .from("report_settings")
        .select("*")
        .eq("id", "default")
        .maybeSingle<{ last_sent_date?: string | null; updated_at?: string | null }>();
      if (settings?.last_sent_date === date) {
        return NextResponse.json({ skipped: "already sent today", date });
      }
      const lastMs = settings?.updated_at ? new Date(settings.updated_at).getTime() : 0;
      if (lastMs && Date.now() - lastMs < 18 * 3600_000) {
        return NextResponse.json({ skipped: "a report was sent in the last 18 hours", date });
      }
    }

    const reportDate = istParts(Date.now() - 24 * 60 * 60 * 1000).date;
    const { inboundCount, outboundCount, delivery } = await generateAndSendReport({ emails, istDate: reportDate });

    if (!force) {
      await supabase.from("report_settings").update({ updated_at: new Date().toISOString() }).eq("id", "default");
      await supabase.from("report_settings").update({ last_sent_date: date }).eq("id", "default");
    }
    return NextResponse.json({ sent: true, inboundCount, outboundCount, date, reportDate, delivery });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[otis] daily-report crashed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const POST = GET;
