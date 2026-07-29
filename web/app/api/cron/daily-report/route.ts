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
// GET /api/cron/daily-report?key=YOUR_CRON_SECRET
// It self-gates: sends the previous day's report only once, at the first ping at or
// after the configured IST send time. Add &force=1 to send immediately.
export async function GET(req: Request) {
try {
const url = new URL(req.url);
const key = url.searchParams.get("key");
const force = url.searchParams.get("force") === "1";

// CRON_SECRET env var sets the auth key; falls back to built-in key so
// manual force-sends work even before the env var propagates.
const secret = process.env.CRON_SECRET || "otis-cron-gromo-2026";
const viaVercelCron = req.headers.get("authorization") === `Bearer ${secret}`;
const viaKey = key === secret;
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

// Skip Sunday only — Saturday report covers Friday's calls
if (!force) {
const istDay = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" })).getDay();
if (istDay === 0) {
return NextResponse.json({ skipped: "sunday" });
}
}

const emails = parseEmails(settings.emails);
if (emails.length === 0) {
return NextResponse.json({ skipped: "no recipients" });
}

const dateParam = url.searchParams.get("date");
const { date: todayDate, minutes } = istParts();

// Report on YESTERDAY's calls — the cron runs at 7am IST so today's
// workday has barely started; yesterday's data is what's complete.
const yesterday = istParts(Date.now() - 24 * 60 * 60 * 1000);
const reportDate = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)
? dateParam
: yesterday.date;

if (!force) {
if (settings.last_sent_date === reportDate) {
return NextResponse.json({ skipped: "already sent for this date", date: reportDate });
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

if (!force) {
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

// Allow POST too (some schedulers default to POST).
export const POST = GET;
