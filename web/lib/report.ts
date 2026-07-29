import { createAdminClient } from "@/lib/supabase/admin";
import { buildAuditsXlsx, AUDIT_EXPORT_COLUMNS } from "@/lib/audit-export";

export type ReportSettings = {
  id: string;
  emails: string | null;
  send_time: string | null;
  timezone: string;
  enabled: boolean;
  last_sent_date: string | null;
  updated_at: string | null;
};

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

export function istParts(nowMs = Date.now()): {
  date: string;
  minutes: number;
} {
  const d = new Date(nowMs + IST_OFFSET_MS);
  return {
    date: d.toISOString().slice(0, 10),
    minutes: d.getUTCHours() * 60 + d.getUTCMinutes(),
  };
}

export function istDayRangeUtc(istDate: string): { gte: string; lte: string } {
  return {
    gte: new Date(`${istDate}T00:00:00+05:30`).toISOString(),
    lte: new Date(`${istDate}T23:59:59.999+05:30`).toISOString(),
  };
}

export function parseHHMM(v: string | null | undefined): number | null {
  if (!v) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(v.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

export function parseEmails(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(/[,\n;]/)
    .map((s) => s.trim())
    .filter((s) => /.+@.+\..+/.test(s));
}

async function sendReportEmail(opts: {
  to: string[];
  subject: string;
  html: string;
  filename: string;
  xlsx: Uint8Array;
}): Promise<void> {
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;
  const from = process.env.REPORT_FROM_EMAIL || smtpUser;

  if (smtpUser && smtpPass) {
    const { createTransport } = await import("nodemailer");
    const transport = createTransport({
      service: "gmail",
      auth: { user: smtpUser, pass: smtpPass },
    });
    await transport.sendMail({
      from: from || smtpUser,
      to: opts.to.join(", "),
      subject: opts.subject,
      html: opts.html,
      attachments: [
        { filename: opts.filename, content: Buffer.from(opts.xlsx) },
      ],
    });
    return;
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error(
      "No email transport configured. Set SMTP_USER + SMTP_PASS (Gmail app " +
        "password) or RESEND_API_KEY.",
    );
  }
  if (!from) throw new Error("REPORT_FROM_EMAIL is not set");

  const base64 = Buffer.from(opts.xlsx).toString("base64");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
      attachments: [{ filename: opts.filename, content: base64 }],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Resend ${res.status}: ${body.slice(0, 300)}`);
  }
}

type StatRow = {
  overall_score: number | null;
  summary: string | null;
  what_was_lacking: string | null;
  mobile_number: string | null;
  agents: { name: string } | null;
};

function scoreColor(pct: number | null): string {
  if (pct == null) return "#888888";
  return pct >= 80 ? "#16a34a" : pct >= 60 ? "#ca8a04" : "#dc2626";
}

function toQualityPct(score: number | null): number | null {
  if (score == null) return null;
  return Math.round((score / 5) * 100);
}

function fmtDate(istDate: string): string {
  return new Date(`${istDate}T12:00:00+05:30`).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  });
}

export async function generateAndSendReport(opts: {
  emails: string[];
  istDate: string;
}): Promise<{ count: number }> {
  const supabase = createAdminClient();
  const { gte, lte } = istDayRangeUtc(opts.istDate);

  const [
    { data: exportData, error: exportError },
    { data: statData, error: statError },
  ] = await Promise.all([
    supabase
      .from("audits")
      .select(AUDIT_EXPORT_COLUMNS)
      .gte("timestamp", gte)
      .lte("timestamp", lte)
      .order("timestamp", { ascending: false })
      .limit(10000),
    supabase
      .from("audits")
      .select("overall_score, summary, what_was_lacking, mobile_number, agents(name)")
      .gte("timestamp", gte)
      .lte("timestamp", lte)
      .order("overall_score", { ascending: true })
      .limit(10000),
  ]);

  if (exportError) throw new Error(exportError.message);
  if (statError) throw new Error(statError.message);

  const rows = exportData ?? [];
  const allRows = (statData ?? []) as StatRow[];

  type AgentStat = { total: number; scores: number[]; good: number; poor: number };
  const agentMap = new Map<string, AgentStat>();
  for (const r of allRows) {
    const name = (r.agents as any)?.name ?? "Unknown";
    if (!agentMap.has(name)) agentMap.set(name, { total: 0, scores: [], good: 0, poor: 0 });
    const ag = agentMap.get(name)!;
    ag.total++;
    const pct = toQualityPct(r.overall_score);
    if (pct != null) {
      ag.scores.push(pct);
      if (pct >= 80) ag.good++;
      else if (pct < 60) ag.poor++;
    }
  }

  const agents = [...agentMap.entries()]
    .map(([name, ag]) => ({
      name,
      total: ag.total,
      scored: ag.scores.length,
      avg:
        ag.scores.length > 0
          ? Math.round(ag.scores.reduce((a, b) => a + b, 0) / ag.scores.length)
          : null,
      good: ag.good,
      poor: ag.poor,
    }))
    .sort((a, b) => (b.avg ?? -1) - (a.avg ?? -1));

  const scoredRows = allRows.filter((r) => r.overall_score != null);
  const avgPct =
    scoredRows.length > 0
      ? Math.round(
          scoredRows.reduce((s, r) => s + toQualityPct(r.overall_score!)!, 0) /
            scoredRows.length,
        )
      : null;

  const coaching = allRows
    .filter((r) => r.overall_score != null && r.summary)
    .slice(0, 10)
    .map((r) => ({
      mobile: r.mobile_number ?? "—",
      agentName: (r.agents as any)?.name ?? "Unknown",
      pct: toQualityPct(r.overall_score!)!,
      summary: r.summary!,
      lacking: r.what_was_lacking,
    }));

  const displayDate = fmtDate(opts.istDate);
  const avgColor = scoreColor(avgPct);

  const agentTableRows = agents
    .map(
      (a) =>
        `<tr>
          <td style="padding:10px 12px;border-bottom:1px solid #f0f0f0;color:#111;font-weight:500">${a.name}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #f0f0f0;color:#555;font-size:13px">${a.total}<span style="color:#bbb;font-size:12px"> (${a.scored} scored)</span></td>
          <td style="padding:10px 12px;border-bottom:1px solid #f0f0f0">
            <span style="display:inline-block;width:${a.avg != null ? Math.round(a.avg * 0.7) : 0}px;height:5px;background:${scoreColor(a.avg)};border-radius:3px;vertical-align:middle;margin-right:6px"></span>
            <strong style="color:${scoreColor(a.avg)}">${a.avg != null ? a.avg + "%" : "—"}</strong>
          </td>
          <td style="padding:10px 12px;border-bottom:1px solid #f0f0f0;color:#16a34a;font-weight:500">${a.good}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #f0f0f0;color:#dc2626;font-weight:500">${a.poor}</td>
        </tr>`,
    )
    .join("");

  const coachingHtml =
    coaching.length > 0
      ? coaching
          .map(
            (c) =>
              `<div style="border:1px solid #e5e7eb;border-radius:8px;padding:12px 14px;margin-bottom:10px">
                <table width="100%" cellpadding="0" cellspacing="0"><tr>
                  <td style="font-size:13px;font-weight:600;color:#111">${c.mobile}&nbsp;<span style="color:#888;font-weight:400">${c.agentName}</span></td>
                  <td align="right" style="font-size:14px;font-weight:700;color:${scoreColor(c.pct)}">${c.pct}%</td>
                </tr></table>
                <p style="margin:6px 0 0;font-size:13px;color:#555;line-height:1.5">${c.summary}</p>
                ${c.lacking ? `<p style="margin:6px 0 0;font-size:12px;color:#999"><b>What was lacking:</b> ${c.lacking}</p>` : ""}
              </div>`,
          )
          .join("")
      : "";

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:20px;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif">
<div style="max-width:620px;margin:0 auto;background:#ffffff;border-radius:10px;overflow:hidden;border:1px solid #e5e7eb">
  <div style="background:#111111;padding:24px 28px">
    <p style="margin:0 0 6px;font-size:11px;color:#aaaaaa;letter-spacing:0.08em;text-transform:uppercase">Otis · AI Call Auditor</p>
    <h1 style="margin:0 0 6px;font-size:20px;color:#ffffff;font-weight:600">Daily call quality report</h1>
    <p style="margin:0;font-size:14px;color:#aaaaaa">Report for <span style="color:#ffffff;font-weight:600">${displayDate}</span></p>
  </div>
  <div style="padding:24px 28px">
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px"><tr>
      <td style="width:33%;padding-right:6px"><div style="background:#f9fafb;border-radius:8px;padding:14px 12px">
        <p style="margin:0 0 4px;font-size:11px;color:#888;text-transform:uppercase;letter-spacing:0.05em">Total calls</p>
        <p style="margin:0;font-size:24px;font-weight:600;color:#111">${allRows.length}</p>
      </div></td>
      <td style="width:33%;padding:0 3px"><div style="background:#f9fafb;border-radius:8px;padding:14px 12px">
        <p style="margin:0 0 4px;font-size:11px;color:#888;text-transform:uppercase;letter-spacing:0.05em">Scored</p>
        <p style="margin:0;font-size:24px;font-weight:600;color:#111">${scoredRows.length}</p>
      </div></td>
      <td style="width:33%;padding-left:6px"><div style="background:#f9fafb;border-radius:8px;padding:14px 12px">
        <p style="margin:0 0 4px;font-size:11px;color:#888;text-transform:uppercase;letter-spacing:0.05em">Avg quality</p>
        <p style="margin:0;font-size:24px;font-weight:600;color:${avgColor}">${avgPct != null ? avgPct + "%" : "—"}</p>
      </div></td>
    </tr></table>
    <p style="margin:0 0 10px;font-size:11px;color:#888;text-transform:uppercase;letter-spacing:0.07em;font-weight:600">Agent breakdown</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-bottom:28px;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden">
      <thead><tr style="background:#f9fafb">
        <th style="padding:8px 12px;text-align:left;font-size:11px;color:#888;font-weight:500;border-bottom:1px solid #e5e7eb">Agent</th>
        <th style="padding:8px 12px;text-align:left;font-size:11px;color:#888;font-weight:500;border-bottom:1px solid #e5e7eb">Calls</th>
        <th style="padding:8px 12px;text-align:left;font-size:11px;color:#888;font-weight:500;border-bottom:1px solid #e5e7eb">Avg quality</th>
        <th style="padding:8px 12px;text-align:left;font-size:11px;color:#888;font-weight:500;border-bottom:1px solid #e5e7eb">Good ≥80%</th>
        <th style="padding:8px 12px;text-align:left;font-size:11px;color:#888;font-weight:500;border-bottom:1px solid #e5e7eb">Poor &lt;60%</th>
      </tr></thead>
      <tbody>${agentTableRows}</tbody>
    </table>
    ${coachingHtml ? `<p style="margin:0 0 10px;font-size:11px;color:#888;text-transform:uppercase;letter-spacing:0.07em;font-weight:600">Needs coaching — lowest scoring calls</p>${coachingHtml}` : ""}
    <p style="margin:24px 0 0;font-size:12px;color:#aaa;border-top:1px solid #f0f0f0;padding-top:16px">Full audit data attached as Excel file. Sent automatically by Otis.</p>
  </div>
</div>
</body></html>`;

  const xlsx = await buildAuditsXlsx(rows);
  await sendReportEmail({
    to: opts.emails,
    subject: `Otis daily report — ${displayDate}`,
    html,
    filename: `otis-audits-${opts.istDate}.xlsx`,
    xlsx,
  });

  return { count: rows.length };
      }
