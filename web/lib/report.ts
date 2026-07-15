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

  // Preferred when configured: Gmail (or any) SMTP via an app password — no
  // domain verification needed, and Google signs it so it lands in inboxes.
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

  // Fallback: Resend HTTP API (needs a verified sender domain).
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

type AgentCoachRow = {
  agent_id: string | null;
  overall_score: number | null;
  recommendations_json: string | null;
  agents: { name: string } | null;
};

function buildCoachingSection(rows: AgentCoachRow[]): string {
  // Group by agent
  const agentMap = new Map<
    string,
    { name: string; scores: number[]; recs: Set<string> }
  >();

  for (const row of rows) {
    if (!row.agent_id || row.overall_score == null) continue;
    if (!agentMap.has(row.agent_id)) {
      agentMap.set(row.agent_id, {
        name: row.agents?.name ?? "Unknown",
        scores: [],
        recs: new Set(),
      });
    }
    const entry = agentMap.get(row.agent_id)!;
    entry.scores.push(row.overall_score);
    try {
      const parsed: string[] = JSON.parse(row.recommendations_json ?? "[]");
      parsed.slice(0, 3).forEach((r) => entry.recs.add(r));
    } catch {
      // ignore malformed JSON
    }
  }

  if (agentMap.size === 0) return "";

  const agentCards = Array.from(agentMap.entries())
    .sort(([, a], [, b]) => {
      const avgA = a.scores.reduce((s, x) => s + x, 0) / a.scores.length;
      const avgB = b.scores.reduce((s, x) => s + x, 0) / b.scores.length;
      return avgA - avgB; // lowest first — most needs coaching
    })
    .map(([, { name, scores, recs }]) => {
      const avg = scores.reduce((s, x) => s + x, 0) / scores.length;
      const pct = Math.round(avg * 20);
      const color = pct >= 80 ? "#22c55e" : pct >= 60 ? "#f59e0b" : "#ef4444";
      const recItems = [...recs]
        .slice(0, 3)
        .map((r) => `<li style="margin-bottom:4px;font-size:13px;color:#444">${r}</li>`)
        .join("");
      return `
      <div style="border:1px solid #e5e7eb;border-radius:10px;padding:16px;margin-bottom:12px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
          <strong style="font-size:14px">${name}</strong>
          <span style="background:${color};color:#fff;padding:3px 10px;border-radius:20px;font-size:12px;font-weight:600">
            ${pct}% (${scores.length} call${scores.length === 1 ? "" : "s"})
          </span>
        </div>
        ${recItems ? `<ul style="padding-left:18px;margin:0">${recItems}</ul>` : ""}
      </div>`;
    })
    .join("");

  return `
  <div style="margin-top:32px">
    <h3 style="font-size:14px;text-transform:uppercase;letter-spacing:.08em;color:#555;margin-bottom:12px">
      Coaching Notes (Today's Calls)
    </h3>
    ${agentCards}
  </div>`;
}

// Build that IST day's audit report (same .xlsx as the dashboard download) and
// email it to the recipients. Returns how many audits it covered.
export async function generateAndSendReport(opts: {
  emails: string[];
  istDate: string;
}): Promise<{ count: number }> {
  const supabase = createAdminClient();
  const { gte, lte } = istDayRangeUtc(opts.istDate);

  const [{ data, error }, { data: coachRows }] = await Promise.all([
    supabase
      .from("audits")
      .select(AUDIT_EXPORT_COLUMNS)
      .gte("timestamp", gte)
      .lte("timestamp", lte)
      .order("timestamp", { ascending: false })
      .limit(10000),
    supabase
      .from("audits")
      .select("agent_id, overall_score, recommendations_json, agents(name)")
      .gte("timestamp", gte)
      .lte("timestamp", lte)
      .not("overall_score", "is", null),
  ]);

  if (error) throw new Error(error.message);
  const rows = data ?? [];

  const coachingHtml = buildCoachingSection(
    (coachRows ?? []) as AgentCoachRow[],
  );

  const xlsx = await buildAuditsXlsx(rows);
  await sendReportEmail({
    to: opts.emails,
    subject: `Otis audit report — ${opts.istDate}`,
    html:
      `<div style="font-family:system-ui,sans-serif;max-width:620px;margin:0 auto;padding:24px">` +
      `<h2 style="margin-top:0">Otis Daily Report — ${opts.istDate}</h2>` +
      `<p>Today's audit report is attached (<strong>${rows.length} audit${rows.length === 1 ? "" : "s"}</strong>). Full breakdown in the Excel file.</p>` +
      coachingHtml +
      `<p style="color:#aaa;font-size:11px;margin-top:32px;border-top:1px solid #eee;padding-top:16px">Sent automatically by Otis AI Call Auditor</p>` +
      `</div>`,
    filename: `otis-audits-${opts.istDate}.xlsx`,
    xlsx,
  });

  return { count: rows.length };
}
