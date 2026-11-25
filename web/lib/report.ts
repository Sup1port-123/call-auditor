import { createAdminClient } from "@/lib/supabase/admin";
import { buildAuditsWorkbook, AUDIT_EXPORT_COLUMNS, vendorOf, type AuditExportRow } from "@/lib/audit-export";
import {
  SCRIPT_COMPLIANCE_CHECKS,
  INBOUND_COMPLIANCE_CHECKS,
  isInboundAgent,
} from "@/lib/rubric";

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
  return { date: d.toISOString().slice(0, 10), minutes: d.getUTCHours() * 60 + d.getUTCMinutes() };
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

// Who gets which report. Override with the Vercel variables DAILY_REPORT_TO /
// INTERVAL_REPORT_TO (comma-separated) if the lists change.
export const DAILY_REPORT_RECIPIENTS = (
  process.env.DAILY_REPORT_TO ?? "vijay.parkash@gromo.in,sameer.singh@gromo.in,anjali.munja@gromo.in"
).split(",").map((e) => e.trim()).filter(Boolean);
export const INTERVAL_REPORT_RECIPIENTS = (
  process.env.INTERVAL_REPORT_TO ?? "anjali.munja@gromo.in,alwarquality_t@gromo.in"
).split(",").map((e) => e.trim()).filter(Boolean);

export function parseEmails(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw.split(/[,\n;]/).map((s) => s.trim()).filter((s) => /.+@.+\..+/.test(s));
}

type ReportRow = {
  id: string;
  source: string | null;
  call_id: string | null;
  mobile: string | null;
  overall_score: number | null;
  summary: string | null;
  what_was_lacking: string | null;
  strengths: string | null;
  target: string | null;
  agent_id: string | null;
  compliance_json: string | null;
  agents: { name: string } | { name: string }[] | null;
};

function extractAgentName(row: ReportRow): string {
  if (!row.agents) return "Unknown Agent";
  if (Array.isArray(row.agents)) return row.agents[0]?.name ?? "Unknown Agent";
  return (row.agents as { name: string }).name ?? "Unknown Agent";
}

function extractCallReason(complianceJson: string | null): string {
  if (!complianceJson) return "Unknown";
  try {
    const parsed = JSON.parse(complianceJson) as Record<string, unknown>;
    return typeof parsed._call_reason === "string" && parsed._call_reason.trim()
      ? parsed._call_reason.trim() : "Unknown";
  } catch { return "Unknown"; }
}

function shortId(id: string): string { return id.slice(0, 8).toUpperCase(); }

type InsightId = { auditId: string; label: string };

function auditLink({ auditId, label }: InsightId): string {
  return `<a href="https://call-auditor-otis4.vercel.app/audits/${auditId}" style="color:#6366f1;text-decoration:none;font-family:monospace;">${label}</a>`;
}

function splitToPoints(text: string | null): string[] {
  if (!text) return [];
  return text.split(/\.\s+|\n+|;\s*/).map(s => s.trim().replace(/^[-\u2022*\d]+[.)\s]*/, "").trim()).filter(s => s.length >= 12 && s.length <= 200);
}

function aggregateInsights(rows: ReportRow[], getText: (row: ReportRow) => string | null, topN = 5): { text: string; count: number; ids: InsightId[] }[] {
  const map = new Map<string, { displayText: string; count: number; ids: InsightId[] }>();
  for (const row of rows) {
    const points = splitToPoints(getText(row));
    const label = row.call_id || shortId(row.id);
    for (const point of points) {
      const key = point.toLowerCase().replace(/['",.,!?]/g, "").replace(/\s+/g, " ").slice(0, 55).trim();
      if (key.length < 10) continue;
      if (!map.has(key)) map.set(key, { displayText: point, count: 0, ids: [] });
      const entry = map.get(key)!;
      entry.count++;
      if (!entry.ids.find(i => i.auditId === row.id)) entry.ids.push({ auditId: row.id, label });
    }
  }
  return Array.from(map.values()).sort((a, b) => b.count - a.count).slice(0, topN).map(({ displayText, count, ids }) => ({ text: displayText, count, ids: ids.slice(0, 5) }));
}

function renderInsightBullets(rows: ReportRow[], getText: (row: ReportRow) => string | null, title: string, emoji: string, bulletColor: string): string {
  const insights = aggregateInsights(rows, getText);
  if (insights.length === 0) return "";
  const items = insights.map(function(ins: { text: string; count: number; ids: InsightId[] }) {
    return '<li style="margin:10px 0;line-height:1.6;">' +
      '<span style="color:' + bulletColor + ';font-weight:600;">&#9658;</span>' +
      '<span style="color:#111;"> ' + ins.text + '</span>' +
      '<span style="color:#6b7280;font-size:11px;"> &mdash; ' + ins.count + ' call' + (ins.count === 1 ? '' : 's') + '</span>' +
      '<div style="font-size:11px;color:#9ca3af;margin-top:2px;">Call IDs: ' + ins.ids.map(auditLink).join(', ') + '</div></li>';
  }).join('');
  return '<h2 style="color:#111;font-size:16px;margin:28px 0 10px 0;font-weight:700;">' + emoji + ' ' + title + '</h2>' +
    '<ul style="margin:0;padding:12px 16px 12px 28px;background:#fff;border:1px solid #e5e7eb;border-radius:6px;list-style:none;">' + items + '</ul>';
}

function renderTransferReasons(rows: ReportRow[]): string {
  const keywords = ["transfer", "escalat", "senior", "manager", "supervisor", "team lead"];
  const map = new Map<string, { displayText: string; ids: InsightId[] }>();
  for (const row of rows) {
    if (!row.summary) continue;
    const sentences = row.summary.split(/[.!?]+/).map(s => s.trim()).filter(Boolean);
    const label = row.call_id || shortId(row.id);
    for (const sentence of sentences) {
      const lower = sentence.toLowerCase();
      if (!keywords.some(kw => lower.includes(kw))) continue;
      const key = lower.replace(/['",.,!?]/g, "").replace(/\s+/g, " ").slice(0, 60).trim();
      if (key.length < 10) continue;
      if (!map.has(key)) map.set(key, { displayText: sentence.trim(), ids: [] });
      const entry = map.get(key)!;
      if (!entry.ids.find(i => i.auditId === row.id)) entry.ids.push({ auditId: row.id, label });
    }
  }
  if (map.size === 0) return "";
  const sorted = Array.from(map.values()).sort((a, b) => b.ids.length - a.ids.length).slice(0, 5);
  const items = sorted.map(function(item: { displayText: string; ids: InsightId[] }) {
    return '<li style="margin:10px 0;line-height:1.6;">' +
      '<span style="color:#f59e0b;font-weight:600;">&#9658;</span>' +
      '<span style="color:#111;"> ' + item.displayText + '</span>' +
      '<span style="color:#6b7280;font-size:11px;"> &mdash; ' + item.ids.length + ' call' + (item.ids.length === 1 ? '' : 's') + '</span>' +
      '<div style="font-size:11px;color:#9ca3af;margin-top:2px;">Call IDs: ' + item.ids.slice(0, 5).map(auditLink).join(', ') + '</div></li>';
  }).join('');
  return '<h2 style="color:#111;font-size:16px;margin:28px 0 10px 0;font-weight:700;">&#128260; Top Call Transfer / Escalation Reasons</h2>' +
    '<ul style="margin:0;padding:12px 16px 12px 28px;background:#fff;border:1px solid #e5e7eb;border-radius:6px;list-style:none;">' + items + '</ul>';
}

export type DeliveryInfo = { accepted: string[]; rejected: string[] };

async function sendReportEmail(opts: { to: string[]; subject: string; html: string; filename: string; xlsx: Uint8Array }): Promise<DeliveryInfo> {
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;
  const from = process.env.REPORT_FROM_EMAIL || smtpUser;

  if (smtpUser && smtpPass) {
    const { createTransport } = await import("nodemailer");
    const smtpHost = process.env.SMTP_HOST || "smtp-relay.brevo.com";
    const transport = createTransport(
      { host: smtpHost, port: 587, secure: false, auth: { user: smtpUser, pass: smtpPass } },
    );
    // One message per recipient, so a problem with one mailbox cannot affect the
    // others, and the mail server's answer is known for each address.
    const delivery: DeliveryInfo = { accepted: [], rejected: [] };
    for (const to of opts.to) {
      try {
        const info = await transport.sendMail({ from: from || smtpUser, to, subject: opts.subject, html: opts.html, attachments: [{ filename: opts.filename, content: Buffer.from(opts.xlsx) }] });
        delivery.accepted.push(...((info.accepted ?? []) as string[]).map(String));
        delivery.rejected.push(...((info.rejected ?? []) as string[]).map(String));
      } catch (err) {
        console.error(`[otis] report email to ${to} failed:`, err);
        delivery.rejected.push(to);
      }
    }
    console.log(`[otis] report email "${opts.subject}": accepted=${delivery.accepted.join(",")} rejected=${delivery.rejected.join(",")}`);
    return delivery;
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("No email transport configured. Set SMTP_USER + SMTP_PASS or RESEND_API_KEY.");
  if (!from) throw new Error("REPORT_FROM_EMAIL is not set");

  const base64 = Buffer.from(opts.xlsx).toString("base64");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: opts.to, subject: opts.subject, html: opts.html, attachments: [{ filename: opts.filename, content: base64 }] }),
  });
  if (!res.ok) { const body = await res.text(); throw new Error(`Resend ${res.status}: ${body.slice(0, 300)}`); }
  return { accepted: opts.to, rejected: [] };
}

function pct(score: number | null): number {
  if (score == null) return 0;
  return Math.round((score / 5) * 100);
}

function scoreColor(score: number | null): string {
  if (score == null) return "#6b7280";
  const p = pct(score);
  return p >= 80 ? "#16a34a" : p >= 60 ? "#ca8a04" : "#dc2626";
}

function scoreBar(score: number | null): string {
  const p = pct(score);
  const color = scoreColor(score);
  return `<div style="background:#e5e7eb;border-radius:4px;height:8px;width:100%;max-width:100px;display:inline-block;"><div style="background:${color};border-radius:4px;height:8px;width:${p}%;"></div></div>`;
}

function emailHeader(title: string, subtitle: string, accentColor: string): string {
  return `<div style="background:${accentColor};padding:28px 32px;border-radius:8px 8px 0 0;"><div style="color:#fff;font-size:22px;font-weight:700;letter-spacing:-0.5px;">${title}</div><div style="color:rgba(255,255,255,0.8);font-size:13px;margin-top:4px;">${subtitle}</div></div>`;
}

function statsRow(stats: { label: string; value: string | number; color?: string }[]): string {
  const cells = stats.map(s => `<td style="padding:16px 20px;text-align:center;"><div style="font-size:26px;font-weight:700;color:${s.color ?? "#111"};">${s.value}</div><div style="font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;margin-top:2px;">${s.label}</div></td>`).join(`<td style="width:1px;background:#e5e7eb;padding:0;"></td>`);
  return `<table style="width:100%;border-collapse:collapse;background:#fff;border:1px solid #e5e7eb;border-top:none;"><tr>${cells}</tr></table>`;
}

type CallEntry = { target: string | null; score: number | null; summary: string | null; lacking: string | null };
type AgentGroup = { agentName: string; avgScore: number; calls: CallEntry[] };

function buildAgentGroups(rows: ReportRow[], filter: (score: number) => boolean, sort: "asc" | "desc", maxCallsPerAgent = 3): AgentGroup[] {
  const map = new Map<string, { scores: number[]; calls: CallEntry[] }>();
  for (const row of rows) {
    const name = extractAgentName(row);
    const score = row.overall_score;
    if (score == null || !filter(score)) continue;
    if (!map.has(name)) map.set(name, { scores: [], calls: [] });
    const entry = map.get(name)!;
    entry.scores.push(score);
    entry.calls.push({ target: row.target, score, summary: row.summary, lacking: row.what_was_lacking });
  }
  return Array.from(map.entries()).map(([agentName, { scores, calls }]) => ({
    agentName, avgScore: scores.reduce((a, b) => a + b, 0) / scores.length,
    calls: (sort === "asc" ? calls.sort((a, b) => (a.score ?? 0) - (b.score ?? 0)) : calls.sort((a, b) => (b.score ?? 0) - (a.score ?? 0))).slice(0, maxCallsPerAgent),
  })).sort((a, b) => sort === "asc" ? a.avgScore - b.avgScore : b.avgScore - a.avgScore);
}

function renderCallCard(call: CallEntry, accent: string): string {
  const p = pct(call.score);
  const color = scoreColor(call.score);
  const label = call.target ? call.target.replace(/^https?:\/\/[^/]+\//, "").slice(0, 60) : "Unknown call";
  return `<div style="border-left:3px solid ${accent};padding:10px 14px;margin:8px 0;background:#fafafa;border-radius:0 4px 4px 0;">
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;"><span style="font-size:12px;color:#555;word-break:break-all;">${label}</span><span style="font-size:14px;font-weight:700;color:${color};white-space:nowrap;">${p}%</span></div>
    ${call.summary ? `<div style="font-size:12px;color:#374151;margin-top:4px;">${call.summary}</div>` : ""}
    ${call.lacking ? `<div style="font-size:11px;color:#dc2626;margin-top:3px;">⚠ ${call.lacking}</div>` : ""}
  </div>`;
}

function renderCallSection(groups: AgentGroup[], emoji: string, title: string, accent: string): string {
  if (groups.length === 0) return "";
  const agentBlocks = groups.map(g => {
    const cards = g.calls.map(c => renderCallCard(c, accent)).join("");
    return `<div style="margin-bottom:20px;"><div style="font-size:14px;font-weight:600;color:#111;margin-bottom:6px;padding-bottom:4px;border-bottom:1px solid #e5e7eb;">${g.agentName}<span style="font-weight:400;color:#6b7280;font-size:12px;margin-left:8px;">avg ${Math.round(g.avgScore * 20)}%</span></div>${cards}</div>`;
  }).join("");
  return `<h2 style="color:#111;font-size:16px;margin:32px 0 10px 0;font-weight:700;">${emoji} ${title}</h2>${agentBlocks}`;
}

function renderAgentTable(rows: ReportRow[]): string {
  const map = new Map<string, number[]>();
  for (const row of rows) {
    const name = extractAgentName(row);
    if (row.overall_score == null) continue;
    if (!map.has(name)) map.set(name, []);
    map.get(name)!.push(row.overall_score);
  }
  const agents = Array.from(map.entries()).map(([name, scores]) => ({ name, count: scores.length, avg: scores.reduce((a, b) => a + b, 0) / scores.length })).sort((a, b) => b.avg - a.avg);
  if (agents.length === 0) return "";
  const rowsHtml = agents.map(a => {
    const p = Math.round(a.avg * 20);
    const color = scoreColor(a.avg);
    return `<tr style="border-bottom:1px solid #e5e7eb;"><td style="padding:10px 12px;font-weight:500;">${a.name}</td><td style="padding:10px 12px;text-align:center;">${a.count}</td><td style="padding:10px 12px;">${scoreBar(a.avg)}</td><td style="padding:10px 12px;text-align:center;font-weight:700;color:${color};">${p}%</td></tr>`;
  }).join("");
  return `<h2 style="color:#111;font-size:16px;margin:28px 0 10px 0;font-weight:700;">📋 Agent Performance</h2>
  <table style="width:100%;border-collapse:collapse;font-size:13px;background:#fff;border:1px solid #e5e7eb;">
    <thead><tr style="background:#f3f4f6;text-align:left;"><th style="padding:10px 12px;">Agent</th><th style="padding:10px 12px;text-align:center;">Calls</th><th style="padding:10px 12px;">Score</th><th style="padding:10px 12px;text-align:center;">Avg %</th></tr></thead>
    <tbody>${rowsHtml}</tbody>
  </table>`;
}

function renderPerCallBreakdown(rows: ReportRow[]): string {
  if (rows.length === 0) return "";
  const scored = rows.filter(r => r.overall_score != null);
  const total = rows.length;
  const completed = scored.length;
  const avgPct = completed > 0 ? Math.round(scored.reduce((s, r) => s + (r.overall_score ?? 0), 0) / completed * 20) : 0;
  const avgColor = avgPct >= 80 ? "#16a34a" : avgPct >= 60 ? "#ca8a04" : "#dc2626";

  const summaryHtml = `
  <table style="width:100%;border-collapse:collapse;background:#fff;border:1px solid #e5e7eb;margin-bottom:0;">
    <tr>
      <td style="padding:14px 20px;text-align:center;border-right:1px solid #e5e7eb;">
        <div style="font-size:26px;font-weight:700;color:#111;">${total}</div>
        <div style="font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;">TOTAL</div>
      </td>
      <td style="padding:14px 20px;text-align:center;border-right:1px solid #e5e7eb;">
        <div style="font-size:26px;font-weight:700;color:#16a34a;">${completed}</div>
        <div style="font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;">COMPLETED</div>
      </td>
      <td style="padding:14px 20px;text-align:center;border-right:1px solid #e5e7eb;">
        <div style="font-size:26px;font-weight:700;color:#dc2626;">${total - completed}</div>
        <div style="font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;">FAILED</div>
      </td>
      <td style="padding:14px 20px;text-align:center;">
        <div style="font-size:26px;font-weight:700;color:${avgColor};">${avgPct}%</div>
        <div style="font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;">AVG QUALITY</div>
      </td>
    </tr>
  </table>`;

  const sorted = [...rows].sort((a, b) => (a.overall_score ?? 0) - (b.overall_score ?? 0));
  const tableRows = sorted.map(row => {
    const p = pct(row.overall_score);
    const color = scoreColor(row.overall_score);
    const callId = row.call_id || row.id.slice(0, 8).toUpperCase();
    const mobile = row.mobile || '—';
    const summary = (row.summary || '—').slice(0, 200);
    const lacking = (row.what_was_lacking || '—').slice(0, 200);
    return `<tr style="border-bottom:1px solid #e5e7eb;vertical-align:top;">
      <td style="padding:9px 10px;font-size:11px;font-family:monospace;color:#374151;word-break:break-all;max-width:120px;">${callId}</td>
      <td style="padding:9px 10px;font-size:12px;white-space:nowrap;">${mobile !== '—' ? `<a href="tel:${mobile}" style="color:#6366f1;text-decoration:none;">${mobile}</a>` : '—'}</td>
      <td style="padding:9px 10px;text-align:center;font-weight:700;color:${color};white-space:nowrap;">${p}%</td>
      <td style="padding:9px 10px;font-size:12px;color:#374151;max-width:180px;">${summary}</td>
      <td style="padding:9px 10px;font-size:12px;color:#dc2626;font-weight:500;max-width:180px;">${lacking}</td>
    </tr>`;
  }).join('');

  return `<h2 style="color:#111;font-size:16px;margin:32px 0 0 0;font-weight:700;">📊 Per-Call Breakdown</h2>
  ${summaryHtml}
  <table style="width:100%;border-collapse:collapse;font-size:12px;background:#fff;border:1px solid #e5e7eb;border-top:none;">
    <thead>
      <tr style="background:#f3f4f6;text-align:left;">
        <th style="padding:9px 10px;">Call ID</th>
        <th style="padding:9px 10px;">Mobile</th>
        <th style="padding:9px 10px;text-align:center;">Quality %</th>
        <th style="padding:9px 10px;">Summary</th>
        <th style="padding:9px 10px;color:#dc2626;">What Was Lacking</th>
      </tr>
    </thead>
    <tbody>${tableRows}</tbody>
  </table>`;
}

function renderQueryReasons(rows: ReportRow[]): string {
  const reasons = new Map<string, { count: number; ids: InsightId[] }>();
  for (const row of rows) {
    const reason = extractCallReason(row.compliance_json);
    const key = reason.toLowerCase().trim();
    if (key === "unknown" || key === "") continue;
    const display = reason.charAt(0).toUpperCase() + reason.slice(1);
    if (!reasons.has(display)) reasons.set(display, { count: 0, ids: [] });
    const entry = reasons.get(display)!;
    entry.count++;
    const label = row.call_id || shortId(row.id);
    if (!entry.ids.find(i => i.auditId === row.id)) entry.ids.push({ auditId: row.id, label });
  }
  if (reasons.size === 0) return "";
  const sorted = Array.from(reasons.entries()).sort((a, b) => b[1].count - a[1].count).slice(0, 8);
  const total = sorted.reduce((s, e) => s + e[1].count, 0);
  const reasonRows = sorted.map(function(e: [string, { count: number; ids: InsightId[] }]) {
    const reason = e[0]; const count = e[1].count; const ids = e[1].ids;
    const p = total > 0 ? Math.round((count / total) * 100) : 0;
    const idLinks = ids.slice(0, 5).map(auditLink).join(', ');
    return '<tr style="border-bottom:1px solid #e5e7eb;"><td style="padding:9px 12px;"><div style="font-weight:500;">' + reason + '</div><div style="font-size:11px;color:#9ca3af;margin-top:2px;">Call IDs: ' + idLinks + '</div></td><td style="padding:9px 12px;text-align:center;font-weight:600;">' + count + '</td><td style="padding:9px 12px;"><div style="background:#e5e7eb;border-radius:4px;height:10px;width:100%;max-width:160px;"><div style="background:#6366f1;border-radius:4px;height:10px;width:' + p + '%;"></div></div></td><td style="padding:9px 12px;text-align:center;color:#6b7280;">' + p + '%</td></tr>';
  }).join('');
  return '<h2 style="color:#111;font-size:16px;margin:28px 0 10px 0;font-weight:700;">&#128202; Major Queries Received (Top 8)</h2>' +
    '<p style="color:#555;font-size:13px;margin:0 0 10px 0;">Highest-volume inbound query reasons for the day</p>' +
    '<table style="width:100%;border-collapse:collapse;font-size:13px;background:#fff;border:1px solid #e5e7eb;"><thead><tr style="background:#f3f4f6;text-align:left;"><th style="padding:9px 12px;">Query Type</th><th style="padding:9px 12px;text-align:center;">Count</th><th style="padding:9px 12px;">Distribution</th><th style="padding:9px 12px;text-align:center;">%</th></tr></thead><tbody>' + reasonRows + '</tbody></table>';
}

// Share of inbound calls on which a callback / follow-up was scheduled. A call
// counts when the "asked reason before callback" check was applicable (its
// evidence does not say "not applicable"), or the AI's call reason mentions a
// callback.
function callbackStats(rows: ReportRow[]): { total: number; scheduled: number; reasonAsked: number } {
  let total = 0, scheduled = 0, reasonAsked = 0;
  for (const row of rows) {
    if (!row.compliance_json || row.compliance_json === "{}") continue;
    let parsed: Record<string, unknown>;
    try { parsed = JSON.parse(row.compliance_json) as Record<string, unknown>; } catch { continue; }
    total++;
    const check = parsed["asked_gp_reason_before_callback"] as { passed?: boolean; evidence?: string } | undefined;
    const notApplicable = !check || /not applicable|no callback/i.test(check.evidence ?? "");
    const reason = typeof parsed._call_reason === "string" ? parsed._call_reason : "";
    const hasCallback = !notApplicable || /call ?back|schedul/i.test(reason);
    if (!hasCallback) continue;
    scheduled++;
    if (check && !notApplicable && check.passed) reasonAsked++;
  }
  return { total, scheduled, reasonAsked };
}

function renderCallScheduling(rows: ReportRow[]): string {
  const { total, scheduled, reasonAsked } = callbackStats(rows);
  if (total === 0) return "";
  const pct = Math.round((scheduled / total) * 100);
  const properPct = scheduled > 0 ? Math.round((reasonAsked / scheduled) * 100) : 0;
  return '<h2 style="color:#111;font-size:16px;margin:28px 0 10px 0;font-weight:700;">&#128197; Call Scheduling (Callbacks)</h2>' +
    '<table style="width:100%;border-collapse:collapse;font-size:13px;background:#fff;border:1px solid #e5e7eb;"><tbody>' +
    '<tr style="border-bottom:1px solid #e5e7eb;"><td style="padding:9px 12px;">Inbound calls with a callback / follow-up scheduled</td><td style="padding:9px 12px;text-align:right;font-weight:600;">' + scheduled + ' of ' + total + ' (' + pct + '%)</td></tr>' +
    '<tr><td style="padding:9px 12px;">Of those, agent asked the reason before scheduling</td><td style="padding:9px 12px;text-align:right;font-weight:600;">' + reasonAsked + ' of ' + scheduled + ' (' + properPct + '%)</td></tr>' +
    '</tbody></table>';
}

// Inbound calls come from two vendors with different pipelines: Karta and
// Convozen. Shown side by side so each can get its own feedback.
function renderVendorSplit(rows: ReportRow[]): string {
  const vendors: { name: string; match: (r: ReportRow) => boolean }[] = [
    { name: "Karta", match: (r) => r.source === "batch" },
    { name: "Convozen", match: (r) => r.source === "convozen_call_details" },
  ];
  const body = vendors.map(({ name, match }) => {
    const vr = rows.filter(match);
    const scored = vr.filter((r) => r.overall_score != null);
    const pctV = scored.length > 0 ? Math.round((scored.reduce((a, r) => a + (r.overall_score ?? 0), 0) / scored.length) * 20) : null;
    const low = scored.filter((r) => (r.overall_score ?? 5) < 3).length;
    const cb = callbackStats(vr);
    const cbPct = cb.total > 0 ? Math.round((cb.scheduled / cb.total) * 100) : 0;
    const reasons = new Map<string, number>();
    for (const r of vr) {
      const reason = extractCallReason(r.compliance_json).toLowerCase().trim();
      if (!reason || reason === "unknown") continue;
      reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
    }
    const top = [...reasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k} (${v})`).join(", ") || "-";
    const color = pctV == null ? "#6b7280" : pctV >= 80 ? "#16a34a" : pctV >= 60 ? "#ca8a04" : "#dc2626";
    return `<tr style="border-bottom:1px solid #e5e7eb;"><td style="padding:9px 12px;font-weight:600;">${name}</td><td style="padding:9px 12px;text-align:center;">${vr.length}</td><td style="padding:9px 12px;text-align:center;font-weight:700;color:${color};">${pctV == null ? "-" : pctV + "%"}</td><td style="padding:9px 12px;text-align:center;">${low}</td><td style="padding:9px 12px;text-align:center;">${cb.scheduled} (${cbPct}%)</td><td style="padding:9px 12px;font-size:12px;">${top}</td></tr>`;
  }).join("");
  return '<h2 style="color:#111;font-size:16px;margin:28px 0 10px 0;font-weight:700;">&#127970; Inbound by Vendor — Karta vs Convozen</h2>' +
    '<table style="width:100%;border-collapse:collapse;font-size:13px;background:#fff;border:1px solid #e5e7eb;"><thead><tr style="background:#f3f4f6;text-align:left;"><th style="padding:9px 12px;">Vendor</th><th style="padding:9px 12px;text-align:center;">Calls</th><th style="padding:9px 12px;text-align:center;">Quality</th><th style="padding:9px 12px;text-align:center;">Below 60%</th><th style="padding:9px 12px;text-align:center;">Callbacks</th><th style="padding:9px 12px;">Top queries</th></tr></thead><tbody>' + body + '</tbody></table>';
}

function renderInboundComplianceSection(rows: ReportRow[]): string {
  const allChecks = [...SCRIPT_COMPLIANCE_CHECKS, ...INBOUND_COMPLIANCE_CHECKS];
  const withData = rows.filter(r => r.compliance_json && r.compliance_json !== "{}");
  if (withData.length === 0) return "";
  const passCounts: Record<string, number> = {};
  for (const check of allChecks) passCounts[check.key] = 0;
  for (const row of withData) {
    try {
      const parsed = JSON.parse(row.compliance_json ?? "{}") as Record<string, { passed?: boolean }>;
      for (const check of allChecks) { if (parsed[check.key]?.passed === true) passCounts[check.key]++; }
    } catch { /* skip */ }
  }
  const total = withData.length;
  const sections = [{ label: "Standard Script Checks", checks: SCRIPT_COMPLIANCE_CHECKS }, { label: "Inbound-Specific Checks", checks: INBOUND_COMPLIANCE_CHECKS }];
  const sectionsHtml = sections.map(section => {
    const rows2 = section.checks.map(check => {
      const passed = passCounts[check.key] ?? 0;
      const p = total > 0 ? Math.round((passed / total) * 100) : 0;
      const barColor = p >= 80 ? "#16a34a" : p >= 50 ? "#ca8a04" : "#dc2626";
      const emoji = p >= 80 ? "✅" : p >= 50 ? "⚠️" : "❌";
      return `<tr style="border-bottom:1px solid #e5e7eb;"><td style="padding:9px 12px;">${emoji} ${check.name}</td><td style="padding:9px 12px;text-align:center;">${passed}/${total}</td><td style="padding:9px 12px;"><div style="background:#e5e7eb;border-radius:4px;height:10px;width:100%;max-width:160px;"><div style="background:${barColor};border-radius:4px;height:10px;width:${p}%;"></div></div></td><td style="padding:9px 12px;text-align:center;font-weight:700;color:${barColor};">${p}%</td></tr>`;
    }).join("");
    return `<tr style="background:#f9fafb;"><td colspan="4" style="padding:8px 12px;font-weight:600;font-size:12px;color:#374151;text-transform:uppercase;letter-spacing:0.5px;">${section.label}</td></tr>${rows2}`;
  }).join("");
  return `<h2 style="color:#111;font-size:16px;margin:28px 0 10px 0;font-weight:700;">✅ Script Compliance — Today's Inbound Calls</h2>
  <p style="color:#555;font-size:13px;margin:0 0 10px 0;">Pass rates across ${total} audited call${total === 1 ? "" : "s"}</p>
  <table style="width:100%;border-collapse:collapse;font-size:13px;background:#fff;border:1px solid #e5e7eb;">
    <thead><tr style="background:#f3f4f6;text-align:left;"><th style="padding:9px 12px;">Check</th><th style="padding:9px 12px;text-align:center;">Passed</th><th style="padding:9px 12px;">Pass Rate</th><th style="padding:9px 12px;text-align:center;">%</th></tr></thead>
    <tbody>${sectionsHtml}</tbody>
  </table>`;
}

function renderOutboundComplianceSection(rows: ReportRow[]): string {
  const withData = rows.filter(r => r.compliance_json && r.compliance_json !== "{}");
  if (withData.length === 0) return "";
  const passCounts: Record<string, number> = {};
  for (const check of SCRIPT_COMPLIANCE_CHECKS) passCounts[check.key] = 0;
  const total = withData.length;
  for (const row of withData) {
    try {
      const parsed = JSON.parse(row.compliance_json ?? "{}") as Record<string, { passed?: boolean }>;
      for (const check of SCRIPT_COMPLIANCE_CHECKS) { if (parsed[check.key]?.passed === true) passCounts[check.key]++; }
    } catch { /* skip */ }
  }
  const checkRows = SCRIPT_COMPLIANCE_CHECKS.map(check => {
    const passed = passCounts[check.key] ?? 0;
    const p = total > 0 ? Math.round((passed / total) * 100) : 0;
    const barColor = p >= 80 ? "#16a34a" : p >= 50 ? "#ca8a04" : "#dc2626";
    const emoji = p >= 80 ? "✅" : p >= 50 ? "⚠️" : "❌";
    return `<tr style="border-bottom:1px solid #e5e7eb;"><td style="padding:9px 12px;">${emoji} ${check.name}</td><td style="padding:9px 12px;text-align:center;">${passed}/${total}</td><td style="padding:9px 12px;"><div style="background:#e5e7eb;border-radius:4px;height:10px;width:100%;max-width:160px;"><div style="background:${barColor};border-radius:4px;height:10px;width:${p}%;"></div></div></td><td style="padding:9px 12px;text-align:center;font-weight:700;color:${barColor};">${p}%</td></tr>`;
  }).join("");
  return `<h2 style="color:#111;font-size:16px;margin:28px 0 10px 0;font-weight:700;">✅ Script Compliance — Today's Outbound Calls</h2>
  <p style="color:#555;font-size:13px;margin:0 0 10px 0;">Pass rates across ${total} audited call${total === 1 ? "" : "s"}</p>
  <table style="width:100%;border-collapse:collapse;font-size:13px;background:#fff;border:1px solid #e5e7eb;">
    <thead><tr style="background:#f3f4f6;text-align:left;"><th style="padding:9px 12px;">Check</th><th style="padding:9px 12px;text-align:center;">Passed</th><th style="padding:9px 12px;">Pass Rate</th><th style="padding:9px 12px;text-align:center;">%</th></tr></thead>
    <tbody>${checkRows}</tbody>
  </table>`;
}

function formatDisplayDate(istDate: string): string {
  try {
    const d = new Date(`${istDate}T12:00:00+05:30`);
    return d.toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Kolkata" });
  } catch { return istDate; }
}

async function buildInboundHtml(rows: ReportRow[], istDate: string): Promise<string> {
  const displayDate = formatDisplayDate(istDate);
  const scored = rows.filter(r => r.overall_score != null);
  const avgScore = scored.length > 0 ? scored.reduce((s, r) => s + (r.overall_score ?? 0), 0) / scored.length : 0;
  const avgPct = Math.round(avgScore * 20);
  const badGroups = buildAgentGroups(rows, s => s < 3, "asc");
  const goodGroups = buildAgentGroups(rows, s => s >= 4, "desc");
  const agentNames = [...new Set(rows.map(r => extractAgentName(r)).filter(n => n !== "Unknown Agent"))];
  const header = emailHeader(
    `📞 Inbound Support Report — ${displayDate}`,
    agentNames.length > 0 ? `${agentNames.join(" · ")} — ${rows.length} call${rows.length === 1 ? "" : "s"} audited` : `Otis daily quality audit · ${rows.length} call${rows.length === 1 ? "" : "s"} processed`,
    "#6366f1",
  );
  const stats = statsRow([
    { label: "Total Calls", value: rows.length },
    { label: "Scored", value: scored.length },
    { label: "Avg Score", value: `${avgPct}%`, color: avgPct >= 80 ? "#16a34a" : avgPct >= 60 ? "#ca8a04" : "#dc2626" },
  ]);
  const agentTable = renderAgentTable(rows);
  const queryReasons = renderQueryReasons(rows);
  const callScheduling = renderCallScheduling(rows);
  const vendorSplit = renderVendorSplit(rows);
  const complianceSection = renderInboundComplianceSection(rows);
  const badCallsSection = renderCallSection(badGroups, "🔻", "Calls Needing Attention (Score < 60%)", "#dc2626");
  const goodCallsSection = renderCallSection(goodGroups, "⭐", "Best Calls (Score ≥ 80%)", "#16a34a");
  const weaknessInsights = renderInsightBullets(rows, r => r.what_was_lacking, "Major Areas Where Agents Lacked", "❌", "#dc2626");
  const strengthInsights = renderInsightBullets(rows, r => r.strengths, "Areas Where Agents Did Well", "✅", "#16a34a");
  const transferReasons = renderTransferReasons(rows);
  const perCallTable = renderPerCallBreakdown(rows);
  return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:760px;margin:0 auto;color:#111;">
    ${header}
    <div style="padding:24px 0;">
      ${stats}
      ${agentTable}
      ${vendorSplit}
      ${queryReasons}
      ${callScheduling}
      ${weaknessInsights}
      ${strengthInsights}
      ${transferReasons}
      ${complianceSection}
      ${badCallsSection}
      ${goodCallsSection}
      ${perCallTable}
      <p style="color:#9ca3af;font-size:11px;margin-top:32px;padding-top:16px;border-top:1px solid #e5e7eb;">Sent automatically by Otis · ${displayDate} IST</p>
    </div>
  </div>`;
}

async function buildOutboundHtml(rows: ReportRow[], istDate: string): Promise<string> {
  const displayDate = formatDisplayDate(istDate);
  const scored = rows.filter(r => r.overall_score != null);
  const avgScore = scored.length > 0 ? scored.reduce((s, r) => s + (r.overall_score ?? 0), 0) / scored.length : 0;
  const avgPct = Math.round(avgScore * 20);
  const badGroups = buildAgentGroups(rows, s => s < 3, "asc");
  const goodGroups = buildAgentGroups(rows, s => s >= 4, "desc");
  const agentNames = [...new Set(rows.map(r => extractAgentName(r)).filter(n => n !== "Unknown Agent"))];
  const header = emailHeader(
    `📤 Outbound Calls Report — ${displayDate}`,
    agentNames.length > 0 ? `${agentNames.join(" · ")} — ${rows.length} call${rows.length === 1 ? "" : "s"} audited` : `Otis daily quality audit · ${rows.length} call${rows.length === 1 ? "" : "s"} processed`,
    "#0f766e",
  );
  const stats = statsRow([
    { label: "Total Calls", value: rows.length },
    { label: "Scored", value: scored.length },
    { label: "Avg Score", value: `${avgPct}%`, color: avgPct >= 80 ? "#16a34a" : avgPct >= 60 ? "#ca8a04" : "#dc2626" },
  ]);
  const agentTable = renderAgentTable(rows);
  const complianceSection = renderOutboundComplianceSection(rows);
  const badCallsSection = renderCallSection(badGroups, "🔻", "Calls Needing Attention (Score < 60%)", "#dc2626");
  const goodCallsSection = renderCallSection(goodGroups, "⭐", "Best Calls (Score ≥ 80%)", "#16a34a");
  const perCallTable = renderPerCallBreakdown(rows);
  return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:760px;margin:0 auto;color:#111;">
    ${header}
    <div style="padding:24px 0;">
      ${stats}
      ${agentTable}
      ${complianceSection}
      ${badCallsSection}
      ${goodCallsSection}
      ${perCallTable}
      <p style="color:#9ca3af;font-size:11px;margin-top:32px;padding-top:16px;border-top:1px solid #e5e7eb;">Sent automatically by Otis · ${displayDate} IST</p>
    </div>
  </div>`;
}

// A one-line health check for the top of the report: how many audits were
// created in the last 24 hours and how many fresh ones are still waiting. A
// zero means the sheet sync or scoring has probably stopped.
async function buildHealthHtml(): Promise<string> {
  const supabase = createAdminClient();
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  const freshSince = new Date(Date.now() - 2 * 86_400_000).toISOString();
  const { count: created } = await supabase.from("audits").select("id", { count: "exact", head: true }).gte("created_at", since);
  const { count: pending } = await supabase.from("audits").select("id", { count: "exact", head: true }).in("status", ["queued", "transcribing", "scoring"]).gte("timestamp", freshSince);
  const stopped = (created ?? 0) === 0;
  const color = stopped ? "#dc2626" : (pending ?? 0) > 300 ? "#ca8a04" : "#16a34a";
  const text = stopped
    ? "No new audits were created in the last 24 hours — the Google Sheet sync or scoring may have stopped."
    : `${created} audits created in the last 24 hours · ${pending ?? 0} recent audits still waiting to be scored.`;
  return `<div style="margin:0 0 16px 0;padding:10px 14px;border-left:4px solid ${color};background:#f9fafb;font-size:13px;color:#111;"><b>System check:</b> ${text}</div>`;
}

export async function generateAndSendReport(opts: {
  emails: string[];
  istDate: string;
  // Interval report: audits finalised inside [gte, lte] (by audit time) instead
  // of the calls of one IST day. `label` goes into the subject.
  range?: { gte: string; lte: string; label: string };
  skipIfEmpty?: boolean;
}): Promise<{ inboundCount: number; outboundCount: number; delivery?: DeliveryInfo }> {
  const supabase = createAdminClient();
  const { gte, lte } = opts.range ?? istDayRangeUtc(opts.istDate);
  const dateCol = opts.range ? "audited_at" : "timestamp";

  const { data: allRows, error } = await supabase
    .from("audits")
    .select("id, source, call_id, mobile, overall_score, summary, what_was_lacking, strengths, target, agent_id, compliance_json, agents(name)")
    .gte(dateCol, gte)
    .lte(dateCol, lte)
    .in("status", ["completed", "excluded"])
    .order("timestamp", { ascending: false })
    .limit(10000);

  if (error) throw new Error(error.message);
  const rows = (allRows ?? []) as unknown as ReportRow[];

  const inboundRows = rows.filter(r => isInboundAgent(extractAgentName(r)));
  const outboundRows = rows.filter(r => !isInboundAgent(extractAgentName(r)));

  const { data: xlsxRows } = await supabase
    .from("audits")
    .select(AUDIT_EXPORT_COLUMNS)
    .gte(dateCol, gte)
    .lte(dateCol, lte)
    .order("timestamp", { ascending: false })
    .limit(10000);

  // One workbook, separate sheets, so feedback can go to each vendor / team:
  // Inbound - Karta, Inbound - Convozen, Outbound, plus everything together.
  const xl = (xlsxRows ?? []) as unknown as AuditExportRow[];
  const nameOf = (r: AuditExportRow) => { const a = r.agents; return (Array.isArray(a) ? a[0]?.name : a?.name) ?? ""; };
  const inboundX = xl.filter((r) => isInboundAgent(nameOf(r) || "Unknown Agent"));
  const allXlsx = await buildAuditsWorkbook([
    { name: "Inbound - Karta", rows: inboundX.filter((r) => vendorOf(r) === "Karta") },
    { name: "Inbound - Convozen", rows: inboundX.filter((r) => vendorOf(r) === "Convozen") },
    { name: "Outbound", rows: xl.filter((r) => !isInboundAgent(nameOf(r) || "Unknown Agent")) },
    { name: "All audits", rows: xl },
  ]);

  // One combined email for every agent (inbound and outbound), with a single
  // Excel of the day's audits attached.
  const displayDate = opts.range ? opts.range.label : formatDisplayDate(opts.istDate);
  if (rows.length === 0 && opts.skipIfEmpty) return { inboundCount: 0, outboundCount: 0 };
  if (rows.length === 0) {
    // Still send something, so a quiet day (or a test on a day with no audits)
    // is not mistaken for a broken email setup.
    const emptyDelivery = await sendReportEmail({
      to: opts.emails,
      subject: `Otis Daily Audit Report — ${displayDate} · no calls audited`,
      html: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:760px;margin:0 auto;color:#111;">${emailHeader(`📊 Otis Daily Audit Report — ${displayDate}`, "No calls were audited on this day", "#1f3a5f")}<div style="padding:24px 0;font-size:14px;">${await buildHealthHtml().catch(() => "")}No completed audits were found for ${displayDate} (IST). If calls were expected, check that the Google Sheet sync or batch uploads ran and that their audits finished.</div></div>`,
      filename: `otis-daily-audit-report-${opts.istDate}.xlsx`, xlsx: allXlsx,
    });
    return { inboundCount: 0, outboundCount: 0, delivery: emptyDelivery };
  }
  const healthHtml = await buildHealthHtml().catch(() => "");
  const scored = rows.filter(r => r.overall_score != null);
  const avgPct = scored.length > 0 ? Math.round(scored.reduce((sum, r) => sum + (r.overall_score ?? 0), 0) / scored.length * 20) : 0;
  const agentNames = [...new Set(rows.map(r => extractAgentName(r)).filter(n => n !== "Unknown Agent"))];
  const summary = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:760px;margin:0 auto;color:#111;">
    ${emailHeader(`📊 Otis Daily Audit Report — ${displayDate}`, `${rows.length} call${rows.length === 1 ? "" : "s"} audited across ${agentNames.length || 1} agent${agentNames.length === 1 ? "" : "s"}: ${inboundRows.length} inbound · ${outboundRows.length} outbound`, "#1f3a5f")}
    <div style="padding:24px 0;">
      ${healthHtml}
      ${statsRow([
        { label: "Total Calls", value: rows.length },
        { label: "Inbound", value: inboundRows.length },
        { label: "Outbound", value: outboundRows.length },
        { label: "Avg Score", value: `${avgPct}%`, color: avgPct >= 80 ? "#16a34a" : avgPct >= 60 ? "#ca8a04" : "#dc2626" },
      ])}
      ${renderAgentTable(rows)}
      <p style="color:#6b7280;font-size:12px;margin-top:16px;">The full audit output for every call (scores, rationale, compliance, summary, gaps, recommendations and transcript) is in the attached Excel.</p>
    </div>
  </div>`;
  const divider = '<hr style="border:none;border-top:2px solid #e5e7eb;margin:8px 0 24px 0;">';
  const errors: string[] = [];
  let delivery: DeliveryInfo | undefined;
  try {
    const sections = [summary];
    if (inboundRows.length > 0) sections.push(await buildInboundHtml(inboundRows, opts.istDate));
    if (outboundRows.length > 0) sections.push(await buildOutboundHtml(outboundRows, opts.istDate));
    delivery = await sendReportEmail({
      to: opts.emails,
      subject: `Otis Daily Audit Report — ${displayDate} · ${rows.length} calls${agentNames.length ? ` [${agentNames.join(", ")}]` : ""}`,
      html: sections.join(divider), filename: `otis-daily-audit-report-${opts.istDate}.xlsx`, xlsx: allXlsx,
    });
  } catch (err) { errors.push(`Daily report email failed: ${err instanceof Error ? err.message : String(err)}`); }

  if (errors.length > 0) throw new Error(errors.join("; "));
  return { inboundCount: inboundRows.length, outboundCount: outboundRows.length, delivery };
      }
