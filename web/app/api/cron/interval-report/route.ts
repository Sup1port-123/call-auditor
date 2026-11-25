import { NextResponse } from "next/server";
import { generateAndSendReport, INTERVAL_REPORT_RECIPIENTS, DAILY_REPORT_RECIPIENTS } from "@/lib/report";
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

    // ?test=1&to=address : send one small test email and return exactly what the
    // mail server answered, to find out why a mailbox is not receiving reports.
    if (url.searchParams.get("test") === "1") {
      const to = (url.searchParams.get("to") ?? "").trim();
      const allowed = [...INTERVAL_REPORT_RECIPIENTS, ...DAILY_REPORT_RECIPIENTS];
      if (!allowed.includes(to)) return NextResponse.json({ error: "to must be one of the report recipients" }, { status: 400 });
      const smtpUser = process.env.SMTP_USER;
      const smtpPass = process.env.SMTP_PASS;
      if (!smtpUser || !smtpPass) return NextResponse.json({ error: "SMTP_USER / SMTP_PASS not set" }, { status: 500 });
      const { createTransport } = await import("nodemailer");
      const transport = createTransport({ host: process.env.SMTP_HOST || "smtp-relay.brevo.com", port: 587, secure: false, auth: { user: smtpUser, pass: smtpPass } });
      const from = process.env.REPORT_FROM_EMAIL || smtpUser;
      const stamp = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 16).replace("T", " ");
      const info = await transport.sendMail({ from, to, subject: `Otis test email ${stamp} IST`, html: `<p>This is a test email from Otis sent at ${stamp} IST. If you can read this, report emails can reach this mailbox.</p>` });
      return NextResponse.json({ test: true, from, to, accepted: info.accepted, rejected: info.rejected, response: info.response, messageId: info.messageId });
    }

    const emails = INTERVAL_REPORT_RECIPIENTS;
    if (emails.length === 0) return NextResponse.json({ skipped: "no recipients" });

    const toMs = Date.now();
    const fromMs = toMs - HOURS * 3600_000;
    const { inboundCount, outboundCount, delivery } = await generateAndSendReport({
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
    return NextResponse.json({ sent: inboundCount + outboundCount > 0, inboundCount, outboundCount, hours: HOURS, quality, delivery });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[otis] interval-report crashed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const POST = GET;
