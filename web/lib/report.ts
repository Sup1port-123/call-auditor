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
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.REPORT_FROM_EMAIL;
  if (!apiKey) throw new Error("RESEND_API_KEY is not set");
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

// Build that IST day's audit report (same .xlsx as the dashboard download) and
// email it to the recipients. Returns how many audits it covered.
export async function generateAndSendReport(opts: {
  emails: string[];
  istDate: string;
}): Promise<{ count: number }> {
  const supabase = createAdminClient();
  const { gte, lte } = istDayRangeUtc(opts.istDate);

  const { data, error } = await supabase
    .from("audits")
    .select(AUDIT_EXPORT_COLUMNS)
    .gte("timestamp", gte)
    .lte("timestamp", lte)
    .order("timestamp", { ascending: false })
    .limit(10000);

  if (error) throw new Error(error.message);
  const rows = data ?? [];

  const xlsx = await buildAuditsXlsx(rows);
  await sendReportEmail({
    to: opts.emails,
    subject: `Otis audit report — ${opts.istDate}`,
    html:
      `<p>Attached is the audit report for <strong>${opts.istDate}</strong> (IST): ` +
      `${rows.length} audit${rows.length === 1 ? "" : "s"}.</p>` +
      `<p style="color:#888;font-size:12px">Sent automatically by Otis.</p>`,
    filename: `otis-audits-${opts.istDate}.xlsx`,
    xlsx,
  });

  return { count: rows.length };
}
