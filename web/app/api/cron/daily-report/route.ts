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

    const secret = process.env.CRON_SECRET;
    // Two callers: Vercel Cron (sends "Authorization: Bearer $CRON_SECRET")
    // and an external scheduler (passes ?key=). The Vercel cron IS the
    // schedule, so it bypasses the per-minute send-time gate below.
    const viaVercelCron =
      !!secret && req.headers.get("authorization") === `Bearer ${secret}`;
    const viaKey = !!secret && key === secret;
    if (!viaVercelCron && !viaKey) {
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

    if (!force) {
      if (settings.last_sent_date === date) {
        return NextResponse.json({ skipped: "already sent today", date });
      }
      // The Vercel cron runs once at its configured time, so its firing IS the
      // send time — only the external ?key= scheduler (pinging every ~15 min)
      // needs the per-minute gate.
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

    const { count } = await generateAndSendReport({ emails, istDate: date });

    if (!force) {
      await supabase
        .from("report_settings")
        .update({ last_sent_date: date })
        .eq("id", "default");
    }

    return NextResponse.json({ sent: true, count, date });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[otis] daily-report crashed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// Allow POST too (some schedulers default to POST).
export const POST = GET;
