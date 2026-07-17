import { createAdminClient } from "@/lib/supabase/admin";
import { buildAuditsXlsx, AUDIT_EXPORT_COLUMNS } from "@/lib/audit-export";
import { SCRIPT_COMPLIANCE_CHECKS } from "@/lib/rubric";

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

type AgentCoachRow = {
  name: string;
  callCount: number;
  avgScore: number;
  topGaps: string[];
};

async function buildCoachingSection(
  supabase: ReturnType<typeof createAdminClient>,
  istDate: string,
): Promise<string> {
  const endDate = new Date(`${istDate}T23:59:59.999+05:30`);
  const startDate = new Date(endDate.getTime() - 7 * 24 * 60 * 60 * 1000);

  const [{ data: audits }, { data: agentsList }] = await Promise.all([
    supabase
      .from("audits")
      .select("agent_id, overall_score, what_was_lacking, recommendations_json")
      .gte("timestamp", startDate.toISOString())
      .lte("timestamp", endDate.toISOString())
      .not("agent_id", "is", null)
      .not("overall_score", "is", null),
    supabase.from("agents").select("id, name"),
  ]);

  if (!audits || audits.length === 0) return "";

  const agentNameMap = new Map((agentsList ?? []).map((a) => [a.id, a.name]));

  const agentMap = new Map<string, { scores: number[]; gaps: string[] }>();
  for (const row of audits) {
    const id = row.agent_id;
    if (!id) continue;
    if (!agentMap.has(id)) agentMap.set(id, { scores: [], gaps: [] });
    const entry = agentMap.get(id)!;
    if (row.overall_score != null) entry.scores.push(row.overall_score);
    if (row.what_was_lacking) entry.gaps.push(String(row.what_was_lacking));
    if (Array.isArray(row.recommendations_json)) {
      for (const rec of row.recommendations_json as string[]) {
        if (rec) entry.gaps.push(rec);
      }
    }
  }

  const rows: AgentCoachRow[] = Array.from(agentMap.entries())
    .map(([id, { scores, gaps }]) => ({
      name: agentNameMap.get(id) ?? "Unknown",
      callCount: scores.length,
      avgScore: scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0,
      topGaps: [...new Set(gaps)].slice(0, 3),
    }))
    .sort((a, b) => a.avgScore - b.avgScore);

  if (rows.length === 0) return "";

  const rowsHtml = rows
    .map((r) => {
      const scoreColor = r.avgScore >= 4 ? "#16a34a" : r.avgScore >= 3 ? "#ca8a04" : "#dc2626";
      const gapsHtml =
        r.topGaps.length > 0
          ? `<ul style="margin:4px 0 0 0;padding-left:18px;color:#555;">${r.topGaps.map((g) => `<li>${g}</li>`).join("")}</ul>`
          : "<p style='color:#888;margin:4px 0 0 0;'>No specific gaps recorded.</p>";
      return `
<tr style="border-bottom:1px solid #e5e7eb;">
<td style="padding:10px 12px;font-weight:600;">${r.name}</td>
<td style="padding:10px 12px;text-align:center;">${r.callCount}</td>
<td style="padding:10px 12px;text-align:center;font-weight:700;color:${scoreColor};">${r.avgScore.toFixed(1)}</td>
<td style="padding:10px 12px;">${gapsHtml}</td>
</tr>`;
    })
    .join("");

  return `
<h2 style="color:#111;font-size:16px;margin:32px 0 8px 0;">📋 Agent Coaching Notes (Last 7 Days)</h2>
<table style="width:100%;border-collapse:collapse;font-size:14px;background:#fff;border:1px solid #e5e7eb;">
<thead><tr style="background:#f3f4f6;text-align:left;">
<th style="padding:10px 12px;">Agent</th>
<th style="padding:10px 12px;text-align:center;">Calls</th>
<th style="padding:10px 12px;text-align:center;">Avg Score</th>
<th style="padding:10px 12px;">Top Gaps</th>
</tr></thead>
<tbody>${rowsHtml}</tbody>
</table>`;
}

function buildComplianceSection(rows: { compliance_json: string | null }[]): string {
  const withData = rows.filter((r) => r.compliance_json && r.compliance_json !== "{}");
  if (withData.length === 0) return "";

  const passCounts: Record<string, number> = {};
  const total = withData.length;
  for (const check of SCRIPT_COMPLIANCE_CHECKS) passCounts[check.key] = 0;

  for (const row of withData) {
    try {
      const parsed = JSON.parse(row.compliance_json ?? "{}") as Record<string, { passed?: boolean }>;
      for (const check of SCRIPT_COMPLIANCE_CHECKS) {
        if (parsed[check.key]?.passed === true) passCounts[check.key]++;
      }
    } catch { /* skip */ }
  }

  const checkRows = SCRIPT_COMPLIANCE_CHECKS.map((check) => {
    const passed = passCounts[check.key] ?? 0;
    const pct = total > 0 ? Math.round((passed / total) * 100) : 0;
    const barColor = pct >= 80 ? "#16a34a" : pct >= 50 ? "#ca8a04" : "#dc2626";
    const emoji = pct >= 80 ? "✅" : pct >= 50 ? "⚠️" : "❌";
    return `
<tr style="border-bottom:1px solid #e5e7eb;">
<td style="padding:9px 12px;">${emoji} ${check.name}</td>
<td style="padding:9px 12px;text-align:center;">${passed}/${total}</td>
<td style="padding:9px 12px;">
<div style="background:#e5e7eb;border-radius:4px;height:10px;width:100%;max-width:160px;">
<div style="background:${barColor};border-radius:4px;height:10px;width:${pct}%;"></div>
</div>
</td>
<td style="padding:9px 12px;text-align:center;font-weight:700;color:${barColor};">${pct}%</td>
</tr>`;
  }).join("");

  return `
<h2 style="color:#111;font-size:16px;margin:32px 0 8px 0;">✅ Script Compliance — Today's Calls</h2>
<p style="color:#555;font-size:13px;margin:0 0 10px 0;">Pass rate across ${total} audited call${total === 1 ? "" : "s"} (mandatory script checks)</p>
<table style="width:100%;border-collapse:collapse;font-size:14px;background:#fff;border:1px solid #e5e7eb;">
<thead><tr style="background:#f3f4f6;text-align:left;">
<th style="padding:9px 12px;">Check</th>
<th style="padding:9px 12px;text-align:center;">Passed</th>
<th style="padding:9px 12px;">Pass Rate</th>
<th style="padding:9px 12px;text-align:center;">%</th>
</tr></thead>
<tbody>${checkRows}</tbody>
</table>`;
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
  if (!apiKey) throw new Error("No email transport configured. Set SMTP_USER + SMTP_PASS or RESEND_API_KEY.");
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

export async function generateAndSendReport(opts: {
  emails: string[];
  istDate: string;
}): Promise<{ count: number }> {
  const supabase = createAdminClient();
  const { gte, lte } = istDayRangeUtc(opts.istDate);

  const [{ data, error }, coachingHtml] = await Promise.all([
    supabase
      .from("audits")
      .select(AUDIT_EXPORT_COLUMNS)
      .gte("timestamp", gte)
      .lte("timestamp", lte)
      .order("timestamp", { ascending: false })
      .limit(10000),
    buildCoachingSection(supabase, opts.istDate),
  ]);

  if (error) throw new Error(error.message);
  const rows = data ?? [];

  const complianceHtml = buildComplianceSection(
    rows.map((r) => ({ compliance_json: (r as { compliance_json?: string | null }).compliance_json ?? null })),
  );

  const xlsx = await buildAuditsXlsx(rows);
  await sendReportEmail({
    to: opts.emails,
    subject: `Otis audit report — ${opts.istDate}`,
    html:
      `<p>Attached is the audit report for <strong>${opts.istDate}</strong> (IST): ` +
      `${rows.length} audit${rows.length === 1 ? "" : "s"}.</p>` +
      complianceHtml +
      coachingHtml +
      `<p style="color:#888;font-size:12px;margin-top:24px;">Sent automatically by Otis.</p>`,
    filename: `otis-audits-${opts.istDate}.xlsx`,
    xlsx,
  });

  return { count: rows.length };
}
