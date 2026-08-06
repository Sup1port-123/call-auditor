import { createAdminClient } from "@/lib/supabase/admin";
import { buildAuditsXlsx, AUDIT_EXPORT_COLUMNS } from "@/lib/audit-export";
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

// India Standard Time is a fixed UTC+5:30 (no DST), so we can shift the clock
// directly rather than pulling in a tz library.
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

export function istParts(nowMs = Date.now()): {
  date: string; // YYYY-MM-DD in IST
  minutes: number; // minutes since IST midnight
} {
  const d = new Date(nowMs + IST_OFFSET_MS);
  return {
    date: d.toISOString().slice(0, 10),
    minutes: d.getUTCHours() * 60 + d.getUTCMinutes(),
  };
}

// UTC bounds for a given IST calendar day.
export function istDayRangeUtc(istDate: string): { gte: string; lte: string } {
  return {
    gte: new Date(`${istDate}T00:00:00+05:30`).toISOString(),
    lte: new Date(`${istDate}T23:59:59.999+05:30`).toISOString(),
  };
}

// "HH:MM" → minutes since midnight, or null if malformed.
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

// Lightweight row type for report HTML building (not the full XLSX export row)
type ReportRow = {
  id: string;
  call_id: string | null;
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
      ? parsed._call_reason.trim()
      : "Unknown";
  } catch {
    return "Unknown";
  }
}


// ---- Insight helpers --------------------------------------------------------

function shortId(id: string): string {
  return id.slice(0, 8).toUpperCase();
}

type InsightId = { auditId: string; label: string };

function auditLink({ auditId, label }: InsightId): string {
  return `<a href="https://call-auditor-otis4.vercel.app/audits/${auditId}" style="color:#6366f1;text-decoration:none;font-family:monospace;">${label}</a>`;
}

function splitToPoints(text: string | null): string[] {
  if (!text) return [];
  return text
    .split(/\.\s+|\n+|;\s*/)
    .map(s => s.trim().replace(/^[-\u2022*\d]+[.)\s*/, "").trim())
    .filter(s => s.length >= 12 && s.length <= 200);
}

function aggregateInsights(
  rows: ReportRow[],
  getText: (row: ReportRow) => string | null,
  topN = 5,
): { text: string; count: number; ids: InsightId[] }[] {
  const map = new Map<string, { displayText: string; count: number; ids: InsightId[] }>();
  for (const row of rows) {
    const points = splitToPoints(getText(row));
    const label = row.call_id || shortId(row.id);
    for (const point of points) {
      const key = point.toLowerCase().replace(/['".,!?]/g, "").replace(/\s+/g, " ").slice(0, 55).trim();
      if (key.length < 10) continue;
      if (!map.has(key)) map.set(key, { displayText: point, count: 0, ids: [] });
      const entry = map.get(key)!;
      entry.count++;
      if (!entry.ids.find(i => i.auditId === row.id)) entry.ids.push({ auditId: row.id, label });
    }
  }
  return Array.from(map.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, topN)
    .map(({ displayText, count, ids }) => ({ text: displayText, count, ids: ids.slice(0, 5) }));
}

function renderInsightBullets(
  rows: ReportRow[],
  getText: (row: ReportRow) => string | null,
  title: string,
  emoji: string,
  bulletColor: string,
): string {
  const insights = aggregateInsights(rows, getText);
  if (insights.length === 0) return "";
  const items = insights.map(function(ins: { text: string; count: number; ids: string[] }) {
    return '<li style="margin:10px 0;line-height:1.6;">' +
      '<span style="color:' + bulletColor + ';font-weight:600;">&#9658;</span>' +
      '<span style="color:#111;"> ' + ins.text + '</span>' +
      '<span style="color:#6b7280;font-size:11px;"> &mdash; ' + ins.count + ' call' + (ins.count === 1 ? '' : 's') + '</span>' +
      '<div style="font-size:11px;color:#9ca3af;margin-top:2px;">Call IDs: ' + ins.ids.map(auditLink).join(', ') + '</div>' +
      '</li>';
  }).join('');
  return '<h2 style="color:#111;font-size:16px;margin:28px 0 10px 0;font-weight:700;">' + emoji + ' ' + title + '</h2>' +
    '<ul style="margin:0;padding:12px 16px 12px 28px;background:#fff;border:1px solid #e5e7eb;border-radius:6px;list-style:none;">' +
    items + '</ul>';
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
      const key = lower.replace(/['".,!?]/g, "").replace(/\s+/g, " ").slice(0, 60).trim();
      if (key.length < 10) continue;
      if (!map.has(key)) map.set(key, { displayText: sentence.trim(), ids: [] });
      const entry = map.get(key)!;
      if (!entry.ids.find(i => i.auditId === row.id)) entry.ids.push({ auditId: row.id, label });
    }
  }
  if (map.size === 0) return "";
  const sorted = Array.from(map.values()).sort((a, b) => b.ids.length - a.ids.length).slice(0, 5);
  const items = sorted.map(function(item: { displayText: string; ids: string[] }) {
    return '<li style="margin:10px 0;line-height:1.6;">' +
      '<span style="color:#f59e0b;font-weight:600;">&#9658;</span>' +
      '<span style="color:#111;"> ' + item.displayText + '</span>' +
      '<span style="color:#6b7280;font-size:11px;"> &mdash; ' + item.ids.length + ' call' + (item.ids.length === 1 ? '' : 's') + '</span>' +
      '<div style="font-size:11px;color:#9ca3af;margin-top:2px;">Call IDs: ' + item.ids.slice(0, 5).map(auditLink).join(', ') + '</div>' +
      '</li>';
  }).join('');
  return '<h2 style="color:#111;font-size:16px;margin:28px 0 10px 0;font-weight:700;">&#128260; Top Call Transfer / Escalation Reasons</h2>' +
    '<ul style="margin:0;padding:12px 16px 12px 28px;background:#fff;border:1px solid #e5e7eb;border-radius:6px;list-style:none;">' +
    items + '</ul>';
}

// ---- Email transport ---------------------------------------------------------

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
  if (!apiKey) {
    throw new Error(
      "No email transport configured. Set SMTP_USER + SMTP_PASS or RESEND_API_KEY.",
    );
  }
  if (!from) throw new Error("REPORT_FROM_EMAIL is not set");

  const base64 = Buffer.from(opts.xlsx).toString("base64");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
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

// ---- Shared HTML helpers ----------------------------------------------------

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
  return `
    <div style="background:#e5e7eb;border-radius:4px;height:8px;width:100%;max-width:100px;display:inline-block;">
      <div style="background:${color};border-radius:4px;height:8px;width:${p}%;"></div>
    </div>`;
}

function emailHeader(title: string, subtitle: string, accentColor: string): string {
  return `
  <div style="background:${accentColor};padding:28px 32px;border-radius:8px 8px 0 0;">
    <div style="color:#fff;font-size:22px;font-weight:700;letter-spacing:-0.5px;">${title}</div>
    <div style="color:rgba(255,255,255,0.8);font-size:13px;margin-top:4px;">${subtitle}</div>
  </div>`;
}

function statsRow(stats: { label: string; value: string | number; color?: string }[]): string {
  const cells = stats.map(s => `
    <td style="padding:16px 20px;text-align:center;">
      <div style="font-size:26px;font-weight:700;color:${s.color ?? "#111"};">${s.value}</div>
      <div style="font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;margin-top:2px;">${s.label}</div>
    </td>`).join(`<td style="width:1px;background:#e5e7eb;padding:0;"></td>`);
  return `
  <table style="width:100%;border-collapse:collapse;background:#fff;border:1px solid #e5e7eb;border-top:none;">
    <tr>${cells}</tr>
  </table>`;
}

type CallEntry = { target: string | null; score: number | null; summary: string | null; lacking: string | null };
type AgentGroup = { agentName: string; avgScore: number; calls: CallEntry[] };

function buildAgentGroups(
  rows: ReportRow[],
  filter: (score: number) => boolean,
  sort: "asc" | "desc",
  maxCallsPerAgent = 3,
): AgentGroup[] {
  const map = new Map<string, { scores: number[]; calls: CallEntry[] }>();

  for (const row of rows) {
    const name = extractAgentName(row);
    const score = row.overall_score;
    if (score == null || !filter(score)) continue;
    if (!map.has(name)) map.set(name, { scores: [], calls: [] });
    const entry = map.get(name)!;
    entry.scores.push(score);
    entry.calls.push({
      target: row.target,
      score,
      summary: row.summary,
      lacking: row.what_was_lacking,
    });
  }

  return Array.from(map.entries())
    .map(([agentName, { scores, calls }]) => ({
      agentName,
      avgScore: scores.reduce((a, b) => a + b, 0) / scores.length,
      calls: (sort === "asc"
        ? calls.sort((a, b) => (a.score ?? 0) - (b.score ?? 0))
        : calls.sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
      ).slice(0, maxCallsPerAgent),
    }))
    .sort((a, b) =>
      sort === "asc" ? a.avgScore - b.avgScore : b.avgScore - a.avgScore,
    );
}

function renderCallCard(call: CallEntry, accent: string): string {
  const p = pct(call.score);
  const color = scoreColor(call.score);
  const label = call.target
    ? call.target.replace(/^https?:\/\/[^/]+\//, "").slice(0, 60)
    : "Unknown call";
  return `
  <div style="border-left:3px solid ${accent};padding:10px 14px;margin:8px 0;background:#fafafa;border-radius:0 4px 4px 0;">
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
      <span style="font-size:12px;color:#555;word-break:break-all;">${label}</span>
      <span style="font-size:14px;font-weight:700;color:${color};white-space:nowrap;">${p}%</span>
    </div>
    ${call.summary ? `<div style="font-size:12px;color:#374151;margin-top:4px;">${call.summary}</div>` : ""}
    ${call.lacking ? `<div style="font-size:11px;color:#dc2626;margin-top:3px;">⚠ ${call.lacking}</div>` : ""}
  </div>`;
}

function renderCallSection(
  groups: AgentGroup[],
  emoji: string,
  title: string,
  accent: string,
): string {
  if (groups.length === 0) return "";
  const agentBlocks = groups.map(g => {
    const cards = g.calls.map(c => renderCallCard(c, accent)).join("");
    return `
    <div style="margin-bottom:20px;">
      <div style="font-size:14px;font-weight:600;color:#111;margin-bottom:6px;padding-bottom:4px;border-bottom:1px solid #e5e7eb;">
        ${g.agentName}
        <span style="font-weight:400;color:#6b7280;font-size:12px;margin-left:8px;">avg ${Math.round(g.avgScore * 20)}%</span>
      </div>
      ${cards}
    </div>`;
  }).join("");

  return `
  <h2 style="color:#111;font-size:16px;margin:32px 0 10px 0;font-weight:700;">${emoji} ${title}</h2>
  ${agentBlocks}`;
}

function renderAgentTable(rows: ReportRow[]): string {
  const map = new Map<string, number[]>();
  for (const row of rows) {
    const name = extractAgentName(row);
    if (row.overall_score == null) continue;
    if (!map.has(name)) map.set(name, []);
    map.get(name)!.push(row.overall_score);
  }

  const agents = Array.from(map.entries())
    .map(([name, scores]) => ({
      name,
      count: scores.length,
      avg: scores.reduce((a, b) => a + b, 0) / scores.length,
    }))
    .sort((a, b) => b.avg - a.avg);

  if (agents.length === 0) return "";

  const rowsHtml = agents.map(a => {
    const p = Math.round(a.avg * 20);
    const color = scoreColor(a.avg);
    return `
    <tr style="border-bottom:1px solid #e5e7eb;">
      <td style="padding:10px 12px;font-weight:500;">${a.name}</td>
      <td style="padding:10px 12px;text-align:center;">${a.count}</td>
      <td style="padding:10px 12px;">
        ${scoreBar(a.avg)}
      </td>
      <td style="padding:10px 12px;text-align:center;font-weight:700;color:${color};">${p}%</td>
    </tr>`;
  }).join("");

  return `
  <h2 style="color:#111;font-size:16px;margin:28px 0 10px 0;font-weight:700;">📋 Agent Performance</h2>
  <table style="width:100%;border-collapse:collapse;font-size:13px;background:#fff;border:1px solid #e5e7eb;">
    <thead>
      <tr style="background:#f3f4f6;text-align:left;">
        <th style="padding:10px 12px;">Agent</th>
        <th style="padding:10px 12px;text-align:center;">Calls</th>
        <th style="padding:10px 12px;">Score</th>
        <th style="padding:10px 12px;text-align:center;">Avg %</th>
      </tr>
    </thead>
    <tbody>${rowsHtml}</tbody>
  </table>`;
}

// ---- Inbound-specific sections ----------------------------------------------

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
  const sorted = Array.from(reasons.entries()).sort((a, b) => b[1].count - a[1].count).slice(0, 5);
  const total = sorted.reduce((s, e) => s + e[1].count, 0);
  const reasonRows = sorted.map(function(e: [string, { count: number; ids: string[] }]) {
    const reason = e[0]; const count = e[1].count; const ids = e[1].ids;
    const p = total > 0 ? Math.round((count / total) * 100) : 0;
    const idLinks = ids.slice(0, 5).map(auditLink).join(', ');
    return '<tr style="border-bottom:1px solid #e5e7eb;">' +
      '<td style="padding:9px 12px;"><div style="font-weight:500;">' + reason + '</div>' +
      '<div style="font-size:11px;color:#9ca3af;margin-top:2px;">Call IDs: ' + idLinks + '</div></td>' +
      '<td style="padding:9px 12px;text-align:center;font-weight:600;">' + count + '</td>' +
      '<td style="padding:9px 12px;"><div style="background:#e5e7eb;border-radius:4px;height:10px;width:100%;max-width:160px;"><div style="background:#6366f1;border-radius:4px;height:10px;width:' + p + '%;"></div></div></td>' +
      '<td style="padding:9px 12px;text-align:center;color:#6b7280;">' + p + '%</td></tr>';
  }).join('');
  return '<h2 style="color:#111;font-size:16px;margin:28px 0 10px 0;font-weight:700;">&#128202; Top 5 Query Types Received</h2>' +
    '<p style="color:#555;font-size:13px;margin:0 0 10px 0;">Highest-volume inbound query reasons today</p>' +
    '<table style="width:100%;border-collapse:collapse;font-size:13px;background:#fff;border:1px solid #e5e7eb;">' +
    '<thead><tr style="background:#f3f4f6;text-align:left;"><th style="padding:9px 12px;">Query Type</th><th style="padding:9px 12px;text-align:center;">Count</th><th style="padding:9px 12px;">Distribution</th><th style="padding:9px 12px;text-align:center;">%</th></tr></thead>' +
    '<tbody>' + reasonRows + '</tbody></table>';
}

// ---- Inbound-specific sections ----------------------------------------------

function renderQueryReasons(rows: ReportRow[]): string {
  const reasons = new Map<string, number>();
  for (const row of rows) {
    const reason = extractCallReason(row.compliance_json);
    const key = reason.toLowerCase().trim();
    if (key === "unknown" || key === "") continue;
    // Normalize slightly
    const display = reason.charAt(0).toUpperCase() + reason.slice(1);
    reasons.set(display, (reasons.get(display) ?? 0) + 1);
  }

  if (reasons.size === 0) return "";

  const sorted = Array.from(reasons.entries()).sort((a, b) => b[1] - a[1]);
  const total = sorted.reduce((s, [, c]) => s + c, 0);

  const reasonRows = sorted.map(([reason, count]) => {
    const p = total > 0 ? Math.round((count / total) * 100) : 0;
    return `
    <tr style="border-bottom:1px solid #e5e7eb;">
      <td style="padding:9px 12px;">${reason}</td>
      <td style="padding:9px 12px;text-align:center;font-weight:600;">${count}</td>
      <td style="padding:9px 12px;">
        <div style="background:#e5e7eb;border-radius:4px;height:10px;width:100%;max-width:160px;">
          <div style="background:#6366f1;border-radius:4px;height:10px;width:${p}%;"></div>
        </div>
      </td>
      <td style="padding:9px 12px;text-align:center;color:#6b7280;">${p}%</td>
    </tr>`;
  }).join("");

  return `
  <h2 style="color:#111;font-size:16px;margin:28px 0 10px 0;font-weight:700;">📊 Major Query Reasons</h2>
  <p style="color:#555;font-size:13px;margin:0 0 10px 0;">Why GPs called today (${total} calls with identified reasons)</p>
  <table style="width:100%;border-collapse:collapse;font-size:13px;background:#fff;border:1px solid #e5e7eb;">
    <thead>
      <tr style="background:#f3f4f6;text-align:left;">
        <th style="padding:9px 12px;">Query Reason</th>
        <th style="padding:9px 12px;text-align:center;">Count</th>
        <th style="padding:9px 12px;">Distribution</th>
        <th style="padding:9px 12px;text-align:center;">%</th>
      </tr>
    </thead>
    <tbody>${reasonRows}</tbody>
  </table>`;
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
      for (const check of allChecks) {
        if (parsed[check.key]?.passed === true) passCounts[check.key]++;
      }
    } catch { /* skip */ }
  }

  const total = withData.length;

  const sections = [
    { label: "Standard Script Checks", checks: SCRIPT_COMPLIANCE_CHECKS },
    { label: "Inbound-Specific Checks", checks: INBOUND_COMPLIANCE_CHECKS },
  ];

  const sectionsHtml = sections.map(section => {
    const rows2 = section.checks.map(check => {
      const passed = passCounts[check.key] ?? 0;
      const p = total > 0 ? Math.round((passed / total) * 100) : 0;
      const barColor = p >= 80 ? "#16a34a" : p >= 50 ? "#ca8a04" : "#dc2626";
      const emoji = p >= 80 ? "✅" : p >= 50 ? "⚠️" : "❌";
      return `
      <tr style="border-bottom:1px solid #e5e7eb;">
        <td style="padding:9px 12px;">${emoji} ${check.name}</td>
        <td style="padding:9px 12px;text-align:center;">${passed}/${total}</td>
        <td style="padding:9px 12px;">
          <div style="background:#e5e7eb;border-radius:4px;height:10px;width:100%;max-width:160px;">
            <div style="background:${barColor};border-radius:4px;height:10px;width:${p}%;"></div>
          </div>
        </td>
        <td style="padding:9px 12px;text-align:center;font-weight:700;color:${barColor};">${p}%</td>
      </tr>`;
    }).join("");

    return `
    <tr style="background:#f9fafb;">
      <td colspan="4" style="padding:8px 12px;font-weight:600;font-size:12px;color:#374151;text-transform:uppercase;letter-spacing:0.5px;">${section.label}</td>
    </tr>
    ${rows2}`;
  }).join("");

  return `
  <h2 style="color:#111;font-size:16px;margin:28px 0 10px 0;font-weight:700;">✅ Script Compliance — Today's Inbound Calls</h2>
  <p style="color:#555;font-size:13px;margin:0 0 10px 0;">Pass rates across ${total} audited call${total === 1 ? "" : "s"}</p>
  <table style="width:100%;border-collapse:collapse;font-size:13px;background:#fff;border:1px solid #e5e7eb;">
    <thead>
      <tr style="background:#f3f4f6;text-align:left;">
        <th style="padding:9px 12px;">Check</th>
        <th style="padding:9px 12px;text-align:center;">Passed</th>
        <th style="padding:9px 12px;">Pass Rate</th>
        <th style="padding:9px 12px;text-align:center;">%</th>
      </tr>
    </thead>
    <tbody>${sectionsHtml}</tbody>
  </table>`;
}

// ---- Outbound compliance section (standard 6 checks) ------------------------

function renderOutboundComplianceSection(rows: ReportRow[]): string {
  const withData = rows.filter(r => r.compliance_json && r.compliance_json !== "{}");
  if (withData.length === 0) return "";

  const passCounts: Record<string, number> = {};
  for (const check of SCRIPT_COMPLIANCE_CHECKS) passCounts[check.key] = 0;
  const total = withData.length;

  for (const row of withData) {
    try {
      const parsed = JSON.parse(row.compliance_json ?? "{}") as Record<string, { passed?: boolean }>;
      for (const check of SCRIPT_COMPLIANCE_CHECKS) {
        if (parsed[check.key]?.passed === true) passCounts[check.key]++;
      }
    } catch { /* skip */ }
  }

  const checkRows = SCRIPT_COMPLIANCE_CHECKS.map(check => {
    const passed = passCounts[check.key] ?? 0;
    const p = total > 0 ? Math.round((passed / total) * 100) : 0;
    const barColor = p >= 80 ? "#16a34a" : p >= 50 ? "#ca8a04" : "#dc2626";
    const emoji = p >= 80 ? "✅" : p >= 50 ? "⚠️" : "❌";
    return `
    <tr style="border-bottom:1px solid #e5e7eb;">
      <td style="padding:9px 12px;">${emoji} ${check.name}</td>
      <td style="padding:9px 12px;text-align:center;">${passed}/${total}</td>
      <td style="padding:9px 12px;">
        <div style="background:#e5e7eb;border-radius:4px;height:10px;width:100%;max-width:160px;">
          <div style="background:${barColor};border-radius:4px;height:10px;width:${p}%;"></div>
        </div>
      </td>
      <td style="padding:9px 12px;text-align:center;font-weight:700;color:${barColor};">${p}%</td>
    </tr>`;
  }).join("");

  return `
  <h2 style="color:#111;font-size:16px;margin:28px 0 10px 0;font-weight:700;">✅ Script Compliance — Today's Outbound Calls</h2>
  <p style="color:#555;font-size:13px;margin:0 0 10px 0;">Pass rates across ${total} audited call${total === 1 ? "" : "s"}</p>
  <table style="width:100%;border-collapse:collapse;font-size:13px;background:#fff;border:1px solid #e5e7eb;">
    <thead>
      <tr style="background:#f3f4f6;text-align:left;">
        <th style="padding:9px 12px;">Check</th>
        <th style="padding:9px 12px;text-align:center;">Passed</th>
        <th style="padding:9px 12px;">Pass Rate</th>
        <th style="padding:9px 12px;text-align:center;">%</th>
      </tr>
    </thead>
    <tbody>${checkRows}</tbody>
  </table>`;
}

// ---- Date formatting --------------------------------------------------------

function formatDisplayDate(istDate: string): string {
  // "2026-07-29" → "29 July 2026"
  try {
    const d = new Date(`${istDate}T12:00:00+05:30`);
    return d.toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Kolkata" });
  } catch {
    return istDate;
  }
}

// ---- Inbound report ---------------------------------------------------------

async function buildInboundHtml(rows: ReportRow[], istDate: string): Promise<string> {
  const displayDate = formatDisplayDate(istDate);
  const scored = rows.filter(r => r.overall_score != null);
  const avgScore = scored.length > 0
    ? scored.reduce((s, r) => s + (r.overall_score ?? 0), 0) / scored.length
    : 0;
  const avgPct = Math.round(avgScore * 20);

  const badGroups = buildAgentGroups(rows, s => s < 3, "asc");
  const goodGroups = buildAgentGroups(rows, s => s >= 4, "desc");

  const agentNames = [...new Set(rows.map(r => extractAgentName(r)).filter(n => n !== "Unknown Agent"))];
  const header = emailHeader(
    `📞 Inbound Support Report — ${displayDate}`,
    agentNames.length > 0
      ? `${agentNames.join(" · ")} — ${rows.length} call${rows.length === 1 ? "" : "s"} audited`
      : `Otis daily quality audit · ${rows.length} call${rows.length === 1 ? "" : "s"} processed`,
    "#6366f1",
  );

  const stats = statsRow([
    { label: "Total Calls", value: rows.length },
    { label: "Scored", value: scored.length },
    { label: "Avg Score", value: `${avgPct}%`, color: avgPct >= 80 ? "#16a34a" : avgPct >= 60 ? "#ca8a04" : "#dc2626" },
  ]);

  const agentTable = renderAgentTable(rows);
  const queryReasons = renderQueryReasons(rows);
  const complianceSection = renderInboundComplianceSection(rows);
  const badCallsSection = renderCallSection(badGroups, "🔻", "Calls Needing Attention (Score < 60%)", "#dc2626");
  const goodCallsSection = renderCallSection(goodGroups, "⭐", "Best Calls (Score ≥ 80%)", "#16a34a");
  const weaknessInsights = renderInsightBullets(rows, r => r.what_was_lacking, "Major Areas Where Agents Lacked", "❌", "#dc2626");
  const strengthInsights = renderInsightBullets(rows, r => r.strengths, "Areas Where Agents Did Well", "✅", "#16a34a");
  const transferReasons = renderTransferReasons(rows);

  return `
  <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:680px;margin:0 auto;color:#111;">
    ${header}
    <div style="padding:24px 0;">
      ${stats}
      ${agentTable}
      ${queryReasons}
      ${weaknessInsights}
      ${strengthInsights}
      ${transferReasons}
      ${complianceSection}
      ${badCallsSection}
      ${goodCallsSection}
      <p style="color:#9ca3af;font-size:11px;margin-top:32px;padding-top:16px;border-top:1px solid #e5e7eb;">
        Sent automatically by Otis · ${displayDate} IST
      </p>
    </div>
  </div>`;
}

// ---- Outbound report --------------------------------------------------------

async function buildOutboundHtml(rows: ReportRow[], istDate: string): Promise<string> {
  const displayDate = formatDisplayDate(istDate);
  const scored = rows.filter(r => r.overall_score != null);
  const avgScore = scored.length > 0
    ? scored.reduce((s, r) => s + (r.overall_score ?? 0), 0) / scored.length
    : 0;
  const avgPct = Math.round(avgScore * 20);

  const badGroups = buildAgentGroups(rows, s => s < 3, "asc");
  const goodGroups = buildAgentGroups(rows, s => s >= 4, "desc");

  const agentNames = [...new Set(rows.map(r => extractAgentName(r)).filter(n => n !== "Unknown Agent"))];
  const header = emailHeader(
    `📤 Outbound Calls Report — ${displayDate}`,
    agentNames.length > 0
      ? `${agentNames.join(" · ")} — ${rows.length} call${rows.length === 1 ? "" : "s"} audited`
      : `Otis daily quality audit · ${rows.length} call${rows.length === 1 ? "" : "s"} processed`,
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

  return `
  <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:680px;margin:0 auto;color:#111;">
    ${header}
    <div style="padding:24px 0;">
      ${stats}
      ${agentTable}
      ${complianceSection}
      ${badCallsSection}
      ${goodCallsSection}
      <p style="color:#9ca3af;font-size:11px;margin-top:32px;padding-top:16px;border-top:1px solid #e5e7eb;">
        Sent automatically by Otis · ${displayDate} IST
      </p>
    </div>
  </div>`;
}

// ---- Public API -------------------------------------------------------------

/**
 * Generates and sends separate inbound and outbound daily reports.
 * Both go to the same recipient list; subjects distinguish them.
 * Returns counts for each report type.
 */
export async function generateAndSendReport(opts: {
  emails: string[];
  istDate: string;
}): Promise<{ inboundCount: number; outboundCount: number }> {
  const supabase = createAdminClient();
  const { gte, lte } = istDayRangeUtc(opts.istDate);

  // Fetch all completed audits for the day with agent info
  const { data: allRows, error } = await supabase
    .from("audits")
    .select("id, call_id, overall_score, summary, what_was_lacking, strengths, target, agent_id, compliance_json, agents(name)")
    .gte("timestamp", gte)
    .lte("timestamp", lte)
    .in("status", ["completed", "excluded"])
    .order("timestamp", { ascending: false })
    .limit(10000);

  if (error) throw new Error(error.message);
  const rows = (allRows ?? []) as unknown as ReportRow[];

  // Split into inbound and outbound based on agent name
  const inboundRows = rows.filter(r => isInboundAgent(extractAgentName(r)));
  const outboundRows = rows.filter(r => !isInboundAgent(extractAgentName(r)));

  // Fetch XLSX data (all audits) for attachment
  const { data: xlsxRows } = await supabase
    .from("audits")
    .select(AUDIT_EXPORT_COLUMNS)
    .gte("timestamp", gte)
    .lte("timestamp", lte)
    .order("timestamp", { ascending: false })
    .limit(10000);

  const allXlsx = await buildAuditsXlsx(xlsxRows ?? []);

  const errors: string[] = [];

  // Send inbound report
  if (inboundRows.length > 0) {
    try {
      const html = await buildInboundHtml(inboundRows, opts.istDate);
      await sendReportEmail({
        to: opts.emails,
        subject: `Otis Inbound Report [${[...new Set(inboundRows.map(r => extractAgentName(r)).filter(n => n !== "Unknown Agent"))].join(", ")}] — ${formatDisplayDate(opts.istDate)}`,
        html,
        filename: `otis-inbound-${opts.istDate}.xlsx`,
        xlsx: allXlsx,
      });
    } catch (err) {
      errors.push(`Inbound email failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Send outbound report
  if (outboundRows.length > 0) {
    try {
      const html = await buildOutboundHtml(outboundRows, opts.istDate);
      await sendReportEmail({
        to: opts.emails,
        subject: `Otis Outbound Report [${[...new Set(outboundRows.map(r => extractAgentName(r)).filter(n => n !== "Unknown Agent"))].join(", ")}] — ${formatDisplayDate(opts.istDate)}`,
        html,
        filename: `otis-outbound-${opts.istDate}.xlsx`,
        xlsx: allXlsx,
      });
    } catch (err) {
      errors.push(`Outbound email failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (errors.length > 0) throw new Error(errors.join("; "));

  return { inboundCount: inboundRows.length, outboundCount: outboundRows.length };
         }
