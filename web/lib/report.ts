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

export function istParts(nowMs = Date.now()): { date: string; minutes: number } {
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
    const smtpHost = process.env.SMTP_HOST;
    const transport = createTransport(
      smtpHost
        ? { host: smtpHost, port: 587, secure: false, auth: { user: smtpUser, pass: smtpPass } }
        : { service: "gmail", auth: { user: smtpUser, pass: smtpPass } },
    );
    await transport.sendMail({
      from: from || smtpUser,
      to: opts.to.join(", "),
      subject: opts.subject,
      html: opts.html,
      attachments: [{ filename: opts.filename, content: Buffer.from(opts.xlsx) }],
    });
    return;
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("No email transport configured.");
  if (!from) throw new Error("REPORT_FROM_EMAIL is not set");

  const base64 = Buffer.from(opts.xlsx).toString("base64");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from, to: opts.to, subject: opts.subject, html: opts.html,
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
  agents: { name: string } | { name: string }[] | null;
};

type CallEntry = {
  mobile: string;
  agentName: string;
  pct: number;
  summary: string;
  lacking: string | null;
};

type ProcessGroup = {
  agentName: string;
  avgPct: number;
  calls: CallEntry[];
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
    day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Kolkata",
  });
}

function extractAgentName(r: StatRow): string {
  const v = r.agents;
  return Array.isArray(v)
    ? (v[0]?.name ?? "Unknown")
    : (v as { name: string } | null)?.name ?? "Unknown";
}

function toEntry(r: StatRow): CallEntry {
  return {
    mobile: r.mobile_number ?? "—",
    agentName: extractAgentName(r),
    pct: toQualityPct(r.overall_score!)!,
    summary: r.summary!,
    lacking: r.what_was_lacking ?? null,
  };
}

/**
 * Groups calls by process/agent.
 * Good: score ≥ 80%, up to 3 per agent.
 * Bad:  score < 60%, up to 3 per agent — ALL agents always appear.
 * Each group sorted worst→best (bad) or best→worst (good).
 */
function buildProcessGroups(allRows: StatRow[]): {
  goodGroups: ProcessGroup[];
  badGroups: ProcessGroup[];
} {
  // Only rows with a score and a real summary
  const eligible = allRows.filter(
    (r) => r.overall_score != null && r.summary && r.summary.trim().length > 20,
  );

  // Build per-agent buckets
  const goodMap = new Map<string, CallEntry[]>();
  const badMap  = new Map<string, CallEntry[]>();

  // Sort descending for good, ascending for bad
  const desc = [...eligible].sort((a, b) => (b.overall_score ?? 0) - (a.overall_score ?? 0));
  const asc  = [...eligible].sort((a, b) => (a.overall_score ?? 0) - (b.overall_score ?? 0));

  for (const r of desc) {
    const pct  = toQualityPct(r.overall_score!)!;
    if (pct < 80) break;
    const name = extractAgentName(r);
    if (!goodMap.has(name)) goodMap.set(name, []);
    const bucket = goodMap.get(name)!;
    if (bucket.length < 3) bucket.push(toEntry(r));
  }

  for (const r of asc) {
    const pct  = toQualityPct(r.overall_score!)!;
    if (pct >= 60) break;
    const name = extractAgentName(r);
    if (!badMap.has(name)) badMap.set(name, []);
    const bucket = badMap.get(name)!;
    if (bucket.length < 3) bucket.push(toEntry(r));
  }

  function toGroups(map: Map<string, CallEntry[]>, sortAsc: boolean): ProcessGroup[] {
    return [...map.entries()]
      .map(([agentName, calls]) => ({
        agentName,
        avgPct: Math.round(calls.reduce((s, c) => s + c.pct, 0) / calls.length),
        calls,
      }))
      .sort((a, b) => sortAsc ? a.avgPct - b.avgPct : b.avgPct - a.avgPct);
  }

  return {
    goodGroups: toGroups(goodMap, false), // best agents first
    badGroups:  toGroups(badMap,  true),  // worst agents first
  };
}

function renderCallCard(c: CallEntry, accent: string): string {
  return `
<div style="border:1px solid #e5e7eb;border-left:4px solid ${accent};border-radius:6px;padding:11px 14px;margin-bottom:8px;background:#fafafa;">
  <table width="100%" cellpadding="0" cellspacing="0">
    <tr>
      <td style="font-size:13px;font-weight:600;color:#111;">📞 ${c.mobile}</td>
      <td align="right" style="font-size:14px;font-weight:700;color:${scoreColor(c.pct)};">${c.pct}%</td>
    </tr>
  </table>
  <p style="margin:6px 0 0;font-size:13px;color:#444;line-height:1.55;">${c.summary}</p>
  ${c.lacking ? `<p style="margin:5px 0 0;font-size:12px;color:#888;"><b style="color:#666;">Gap:</b> ${c.lacking}</p>` : ""}
</div>`;
}

function renderProcessSection(
  groups: ProcessGroup[],
  emoji: string,
  title: string,
  accent: string,
): string {
  if (groups.length === 0) return "";

  const groupsHtml = groups
    .map((g) => `
<div style="margin-bottom:18px;">
  <div style="background:#f0f0f0;border-radius:5px;padding:7px 12px;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;">
    <span style="font-size:13px;font-weight:700;color:#111;">${g.agentName}</span>
    <span style="font-size:12px;font-weight:600;color:${scoreColor(g.avgPct)};">${g.avgPct}% avg</span>
  </div>
  ${g.calls.map((c) => renderCallCard(c, accent)).join("")}
</div>`)
    .join("");

  return `
<div style="margin-bottom:28px;">
  <p style="margin:0 0 12px;font-size:12px;color:#555;text-transform:uppercase;letter-spacing:0.07em;font-weight:700;border-bottom:2px solid #e5e7eb;padding-bottom:6px;">${emoji} ${title}</p>
  ${groupsHtml}
</div>`;
}

export async function generateAndSendReport(opts: {
  emails: string[];
  istDate: string;
}): Promise<{ count: number }> {
  const supabase = createAdminClient();
  const { gte, lte } = istDayRangeUtc(opts.istDate);

  const [
    { data: exportData, error: exportError },
    { data: statData,   error: statError   },
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
      .not("overall_score", "is", null)
      .limit(10000),
  ]);

  if (exportError) throw new Error(exportError.message);
  if (statError)   throw new Error(statError.message);

  const rows    = exportData ?? [];
  const allRows = (statData ?? []) as unknown as StatRow[];

  // ── Agent summary table ──────────────────────────────────────────────────
  type AgentStat = { total: number; scores: number[]; good: number; poor: number };
  const agentMap = new Map<string, AgentStat>();

  for (const r of allRows) {
    const name = extractAgentName(r);
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
      total:  ag.total,
      scored: ag.scores.length,
      avg:    ag.scores.length > 0 ? Math.round(ag.scores.reduce((a, b) => a + b, 0) / ag.scores.length) : null,
      good:   ag.good,
      poor:   ag.poor,
    }))
    .sort((a, b) => (b.avg ?? -1) - (a.avg ?? -1));

  const totalScored = allRows.filter((r) => r.overall_score != null).length;
  const avgPct =
    totalScored > 0
      ? Math.round(allRows.filter(r => r.overall_score != null)
          .reduce((s, r) => s + toQualityPct(r.overall_score!)!, 0) / totalScored)
      : null;

  // ── Good / bad groups by process ─────────────────────────────────────────
  const { goodGroups, badGroups } = buildProcessGroups(allRows);

  // ── HTML ─────────────────────────────────────────────────────────────────
  const displayDate = fmtDate(opts.istDate);
  const avgColor    = scoreColor(avgPct);

  const agentRows = agents.map((a) => `
<tr>
  <td style="padding:10px 12px;border-bottom:1px solid #f0f0f0;font-weight:600;color:#111;">${a.name}</td>
  <td style="padding:10px 12px;border-bottom:1px solid #f0f0f0;color:#555;text-align:center;">${a.total}<br><span style="font-size:11px;color:#aaa;">${a.scored} scored</span></td>
  <td style="padding:10px 12px;border-bottom:1px solid #f0f0f0;text-align:center;">
    <strong style="font-size:16px;color:${scoreColor(a.avg)};">${a.avg != null ? a.avg + "%" : "—"}</strong>
  </td>
  <td style="padding:10px 12px;border-bottom:1px solid #f0f0f0;text-align:center;color:#16a34a;font-weight:600;">${a.good}</td>
  <td style="padding:10px 12px;border-bottom:1px solid #f0f0f0;text-align:center;color:#dc2626;font-weight:600;">${a.poor}</td>
</tr>`).join("");

  const goodSectionHtml = renderProcessSection(goodGroups, "⭐", "What Worked — by Process", "#16a34a");
  const badSectionHtml  = renderProcessSection(badGroups,  "🔻", "Needs Attention — by Process", "#dc2626");

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:20px;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;">
<div style="max-width:640px;margin:0 auto;background:#fff;border-radius:10px;overflow:hidden;border:1px solid #e5e7eb;">

  <!-- Header -->
  <div style="background:#111;padding:24px 28px;">
    <p style="margin:0 0 4px;font-size:11px;color:#aaa;letter-spacing:0.08em;text-transform:uppercase;">Otis · AI Call Auditor</p>
    <h1 style="margin:0 0 4px;font-size:20px;color:#fff;font-weight:700;">Daily Call Quality Report</h1>
    <p style="margin:0;font-size:14px;color:#aaa;">Calls on <strong style="color:#fff;">${displayDate}</strong></p>
  </div>

  <div style="padding:24px 28px;">

    <!-- Stats -->
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
      <tr>
        <td style="width:33%;padding-right:6px;">
          <div style="background:#f9fafb;border-radius:8px;padding:14px 12px;text-align:center;">
            <p style="margin:0 0 4px;font-size:11px;color:#888;text-transform:uppercase;">Total Calls</p>
            <p style="margin:0;font-size:26px;font-weight:700;color:#111;">${allRows.length}</p>
          </div>
        </td>
        <td style="width:33%;padding:0 3px;">
          <div style="background:#f9fafb;border-radius:8px;padding:14px 12px;text-align:center;">
            <p style="margin:0 0 4px;font-size:11px;color:#888;text-transform:uppercase;">Scored</p>
            <p style="margin:0;font-size:26px;font-weight:700;color:#111;">${totalScored}</p>
          </div>
        </td>
        <td style="width:33%;padding-left:6px;">
          <div style="background:#f9fafb;border-radius:8px;padding:14px 12px;text-align:center;">
            <p style="margin:0 0 4px;font-size:11px;color:#888;text-transform:uppercase;">Avg Quality</p>
            <p style="margin:0;font-size:26px;font-weight:700;color:${avgColor};">${avgPct != null ? avgPct + "%" : "—"}</p>
          </div>
        </td>
      </tr>
    </table>

    <!-- Agent breakdown -->
    <p style="margin:0 0 10px;font-size:12px;color:#555;text-transform:uppercase;letter-spacing:0.07em;font-weight:700;border-bottom:2px solid #e5e7eb;padding-bottom:6px;">📊 Agent Breakdown</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-bottom:28px;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
      <thead>
        <tr style="background:#f9fafb;">
          <th style="padding:9px 12px;text-align:left;font-size:11px;color:#888;font-weight:600;border-bottom:1px solid #e5e7eb;">Process</th>
          <th style="padding:9px 12px;text-align:center;font-size:11px;color:#888;font-weight:600;border-bottom:1px solid #e5e7eb;">Calls</th>
          <th style="padding:9px 12px;text-align:center;font-size:11px;color:#888;font-weight:600;border-bottom:1px solid #e5e7eb;">Avg Quality</th>
          <th style="padding:9px 12px;text-align:center;font-size:11px;color:#16a34a;font-weight:600;border-bottom:1px solid #e5e7eb;">Good ≥80%</th>
          <th style="padding:9px 12px;text-align:center;font-size:11px;color:#dc2626;font-weight:600;border-bottom:1px solid #e5e7eb;">Poor &lt;60%</th>
        </tr>
      </thead>
      <tbody>${agentRows}</tbody>
    </table>

    <!-- Call observations by process -->
    ${goodSectionHtml}
    ${badSectionHtml}

    <p style="margin:20px 0 0;font-size:12px;color:#aaa;border-top:1px solid #f0f0f0;padding-top:16px;">
      Full audit data is attached as an Excel file. Sent automatically by Otis.
    </p>
  </div>
</div>
</body></html>`;

  const xlsx = await buildAuditsXlsx(rows);
  await sendReportEmail({
    to:       opts.emails,
    subject:  `Otis daily report — ${displayDate}`,
    html,
    filename: `otis-audits-${opts.istDate}.xlsx`,
    xlsx,
  });

  return { count: rows.length };
}
