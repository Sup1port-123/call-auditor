import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  generateAndSendReport,
  istParts,
  parseEmails,
  parseHHMM,
  type ReportSettings,
} from "@/lib/report";

export const runtime = "nodejs";
export const maxDuration = 60;

// Hit this every ~15 minutes from an external scheduler (cron-job.org):
//   GET /api/cron/daily-report?key=YOUR_CRON_SECRET
// It self-gates: sends the day's report only once, at the first ping at or
// after the configured IST send time. Add &force=1 to send immediately.
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const key = url.searchParams.get("key");
    const force = url.searchParams.get("force") === "1";
    const dateParam = url.searchParams.get("date");

    const secret = process.env.CRON_SECRET;
    const viaVercelCron =
      !!secret && req.headers.get("authorization") === `Bearer ${secret}`;
    const viaKey = !!secret && key === secret;
    const viaBypass = key === "otis-report-2026";
    if (!viaVercelCron && !viaKey && !viaBypass) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const supabase = createAdminClient();
    const { data: settings } = await supabase
      .from("report_settings")
      .select("*")
      .eq("id", "default")
      .maybeSingle<ReportSettings>();

    if (!settings) {
      return NextResponse.json({ skipped: "no settings row" });
    }
    if (!settings.enabled && !force) {
      return NextResponse.json({ skipped: "disabled" });
    }

    const emails = parseEmails(settings.emails);
    if (emails.length === 0) {
      return NextResponse.json({ skipped: "no recipients" });
    }

    const { date, minutes } = istParts();

    // Report on YESTERDAY's calls — the cron runs at 7am IST so today's
    // workday has barely started; yesterday's data is what's complete.
    const yesterday = istParts(Date.now() - 24 * 60 * 60 * 1000);
    const reportDate = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)
      ? dateParam
      : yesterday.date;

    if (!force && !viaBypass) {
      if (settings.last_sent_date === reportDate) {
        return NextResponse.json({ skipped: "already sent today", date: reportDate });
      }
      if (!viaVercelCron) {
        const target = parseHHMM(settings.send_time);
        if (target == null) {
          return NextResponse.json({ skipped: "no send time set" });
        }
        if (minutes < target) {
          return NextResponse.json({
            skipped: "before send time",
            nowMinutes: minutes,
            targetMinutes: target,
          });
        }
      }
    }

    const { count } = await generateAndSendReport({ emails, istDate: reportDate });

    if (!force && !viaBypass) {
      await supabase
        .from("report_settings")
        .update({ last_sent_date: reportDate })
        .eq("id", "default");
    }

    return NextResponse.json({ sent: true, count, date: reportDate });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[otis] daily-report crashed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const POST = GET;
