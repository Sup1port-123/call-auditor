import { createAdminClient } from "@/lib/supabase/admin";
import { isInboundAgent } from "@/lib/rubric";

// Who gets the "something is wrong" emails. Override with the Vercel variable
// ALERT_REPORT_TO (comma-separated).
export const ALERT_RECIPIENTS = (
  process.env.ALERT_REPORT_TO ?? "anjali.munja@gromo.in,alwarquality_t@gromo.in"
).split(",").map((e) => e.trim()).filter(Boolean);

const ALERT_MARK = "[alerted]";

function appUrl(): string {
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL;
  const prod = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  return prod ? `https://${prod}` : "";
}

async function sendAlertEmail(subject: string, html: string): Promise<void> {
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;
  const from = process.env.REPORT_FROM_EMAIL || smtpUser;
  if (!smtpUser || !smtpPass) throw new Error("SMTP_USER / SMTP_PASS are not set; cannot send alert email.");
  const { createTransport } = await import("nodemailer");
  const transport = createTransport({
    host: process.env.SMTP_HOST || "smtp-relay.brevo.com",
    port: 587,
    secure: false,
    auth: { user: smtpUser, pass: smtpPass },
  });
  await transport.sendMail({ from: from || smtpUser, to: ALERT_RECIPIENTS.join(", "), subject, html });
}

function shell(title: string, body: string): string {
  return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:760px;margin:0 auto;color:#111;">
  <div style="background:#b91c1c;color:#fff;padding:16px 20px;border-radius:8px 8px 0 0;font-size:18px;font-weight:700;">🚨 ${title}</div>
  <div style="padding:18px 4px;font-size:14px;line-height:1.5;">${body}</div>
  <p style="color:#9ca3af;font-size:11px;border-top:1px solid #e5e7eb;padding-top:12px;">Sent automatically by Otis alerts</p></div>`;
}

type AuditRow = {
  id: string;
  call_id: string | null;
  overall_score: number | null;
  scores_json: string | null;
  compliance_json: string | null;
  what_was_lacking: string | null;
  review_reason: string | null;
  agents: { name: string } | { name: string }[] | null;
};

function agentName(r: { agents: AuditRow["agents"] }): string {
  const a = r.agents;
  return (Array.isArray(a) ? a[0]?.name : a?.name) ?? "No agent";
}

const CRITICAL_CHECKS: Record<string, string> = {
  no_prohibited_guarantees: "Gave a prohibited guarantee or promise",
  no_data_fabrication: "Made up / fabricated information",
  no_credential_request: "Asked the customer for credentials (OTP / PIN / password)",
  followed_knowledge_base: "Did not follow the knowledge base",
};
const WRONG_INFO = /(incorrect|wrong|inaccurate|misleading|false|fabricat\w*|hallucinat\w*|misinform\w*)\s+(information|info|details|claims?|answers?|payout|product|eligibility|fees?)/i;

// Reasons an audit is alarming (agent gave wrong / risky information).
export function criticalReasons(r: AuditRow): string[] {
  const reasons: string[] = [];
  try {
    const c = JSON.parse(r.compliance_json || "{}") as Record<string, { passed?: boolean }>;
    for (const [key, label] of Object.entries(CRITICAL_CHECKS)) {
      if (c[key] && c[key].passed === false) reasons.push(label);
    }
  } catch { /* ignore */ }
  try {
    const s = JSON.parse(r.scores_json || "{}") as Record<string, { score: number | null; min?: number; max?: number }>;
    const pa = s.product_accuracy;
    if (pa && pa.score != null && pa.max != null && pa.min != null && pa.max > pa.min) {
      if ((pa.score - pa.min) / (pa.max - pa.min) <= 0.25) {
        reasons.push(`Product information was very weak or wrong (${pa.score}/${pa.max})`);
      }
    }
  } catch { /* ignore */ }
  if ((r.overall_score ?? 5) <= 3 && WRONG_INFO.test(r.what_was_lacking ?? "")) {
    reasons.push("Auditor flagged incorrect / misleading information");
  }
  return reasons;
}

// Emails any newly finished audit where the agent shared wrong or risky
// information. Each audit is alerted once (it is marked "[alerted]").
export async function checkCriticalAudits(): Promise<{ scanned: number; alerted: number }> {
  const db = createAdminClient();
  const since = new Date(Date.now() - 3 * 3600_000).toISOString();
  const { data, error } = await db
    .from("audits")
    .select("id, call_id, overall_score, scores_json, compliance_json, what_was_lacking, review_reason, agents(name)")
    .eq("status", "completed")
    .gte("audited_at", since)
    .or(`review_reason.is.null,review_reason.not.like.%${ALERT_MARK}%`)
    .limit(1000);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as unknown as AuditRow[];
  const hits = rows.map((r) => ({ r, reasons: criticalReasons(r) })).filter((h) => h.reasons.length > 0);
  if (hits.length === 0) return { scanned: rows.length, alerted: 0 };

  const base = appUrl();
  const lines = hits.slice(0, 40).map(({ r, reasons }) => {
    const pct = r.overall_score == null ? "-" : `${Math.round(r.overall_score * 20)}%`;
    const id = r.call_id || r.id.slice(0, 8);
    const link = base ? `<a href="${base}/audits/${r.id}">${id}</a>` : id;
    return `<tr><td style="padding:7px 10px;border-bottom:1px solid #eee;font-family:monospace;font-size:12px;">${link}</td><td style="padding:7px 10px;border-bottom:1px solid #eee;">${agentName(r)}</td><td style="padding:7px 10px;border-bottom:1px solid #eee;text-align:center;">${pct}</td><td style="padding:7px 10px;border-bottom:1px solid #eee;">${reasons.join("; ")}</td></tr>`;
  }).join("");
  await sendAlertEmail(
    `🚨 Otis alert — ${hits.length} call${hits.length === 1 ? "" : "s"} with wrong information or not following the knowledge base`,
    shell("Agent shared wrong information or did not follow the knowledge base", `<p>${hits.length} newly audited call${hits.length === 1 ? "" : "s"} need a look${hits.length > 40 ? " (first 40 shown)" : ""}:</p>
    <table style="width:100%;border-collapse:collapse;font-size:13px;"><thead><tr style="background:#f3f4f6;text-align:left;"><th style="padding:7px 10px;">Call</th><th style="padding:7px 10px;">Agent</th><th style="padding:7px 10px;">Score</th><th style="padding:7px 10px;">Why</th></tr></thead><tbody>${lines}</tbody></table>`),
  );
  await Promise.all(hits.map(({ r }) =>
    db.from("audits").update({
      needs_review: true,
      review_reason: `${r.review_reason ? r.review_reason + "; " : ""}${ALERT_MARK}`,
    }).eq("id", r.id),
  ));
  return { scanned: rows.length, alerted: hits.length };
}

// Compares inbound quality in the last window with the previous 7 days and
// emails when it falls sharply or is simply low.
const DROP_POINTS = 15;
const LOW_PCT = 60;
const MIN_CALLS = 20;

async function inboundScores(fromIso: string, toIso: string): Promise<number[]> {
  const db = createAdminClient();
  const { data } = await db
    .from("audits")
    .select("overall_score, agents(name)")
    .eq("status", "completed")
    .not("overall_score", "is", null)
    .gte("audited_at", fromIso)
    .lt("audited_at", toIso)
    .limit(1500);
  return ((data ?? []) as unknown as { overall_score: number; agents: AuditRow["agents"] }[])
    .filter((r) => isInboundAgent(agentName(r)))
    .map((r) => r.overall_score);
}

export async function checkQualityDrop(windowFromMs: number, windowToMs: number): Promise<{ sent: boolean; windowPct?: number; basePct?: number; calls?: number }> {
  const win = await inboundScores(new Date(windowFromMs).toISOString(), new Date(windowToMs).toISOString());
  if (win.length < MIN_CALLS) return { sent: false, calls: win.length };
  const winPct = Math.round((win.reduce((a, b) => a + b, 0) / win.length) * 20);
  const base = await inboundScores(new Date(windowFromMs - 7 * 86_400_000).toISOString(), new Date(windowFromMs).toISOString());
  const basePct = base.length >= MIN_CALLS ? Math.round((base.reduce((a, b) => a + b, 0) / base.length) * 20) : null;
  const dropped = basePct != null && basePct - winPct >= DROP_POINTS;
  const low = winPct < LOW_PCT;
  if (!dropped && !low) return { sent: false, windowPct: winPct, basePct: basePct ?? undefined, calls: win.length };
  const why = dropped
    ? `Inbound quality fell to <b>${winPct}%</b> in the last 3 hours, from <b>${basePct}%</b> over the previous 7 days (a drop of ${basePct! - winPct} points).`
    : `Inbound quality is <b>${winPct}%</b> in the last 3 hours, below the ${LOW_PCT}% alert level.`;
  await sendAlertEmail(
    `🚨 Otis alert — inbound quality ${winPct}%${dropped ? ` (down ${basePct! - winPct} points)` : ""}`,
    shell("Inbound quality has dropped", `<p>${why}</p><p>Based on ${win.length} inbound audits. Check the latest 3-hour report for the failure reasons and the calls that need attention.</p>`),
  );
  return { sent: true, windowPct: winPct, basePct: basePct ?? undefined, calls: win.length };
}

// Convozen audits are transcribed by AssemblyAI. When it refuses (credit used up,
// key invalid, rate limit) the audits fail one after another. Email when that
// happens, at most once per 3 hours.
const FAIL_MARK = "[alerted]";
export async function checkTranscriptionFailures(): Promise<{ failed: number; alerted: boolean }> {
  const db = createAdminClient();
  const since = new Date(Date.now() - 60 * 60_000).toISOString();
  const { data, error } = await db
    .from("audits")
    .select("id, error_message")
    .eq("status", "failed")
    .eq("source", "convozen_call_details")
    .like("error_message", "%AssemblyAI submit failed%")
    .not("error_message", "like", `%${FAIL_MARK}%`)
    .gte("created_at", since)
    .limit(200);
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  if (rows.length < 3) return { failed: rows.length, alerted: false };

  // Already told you in the last 3 hours? Mark these and stay quiet.
  const recentSince = new Date(Date.now() - 3 * 3600_000).toISOString();
  const { data: recent } = await db
    .from("audits")
    .select("id")
    .eq("source", "convozen_call_details")
    .like("error_message", `%${FAIL_MARK}%`)
    .gte("created_at", recentSince)
    .limit(1);
  const alreadyTold = (recent ?? []).length > 0;

  if (!alreadyTold) {
    const sample = String(rows[0].error_message).replace(/\s+/g, " ").slice(0, 240);
    await sendAlertEmail(
      "🚨 Otis alert — Convozen audits are failing (AssemblyAI)",
      shell(
        "Convozen audits are failing because of AssemblyAI",
        `<p><b>${rows.length}</b> Convozen audits failed in the last hour because AssemblyAI returned an error.</p>
         <p>Please check the AssemblyAI account: <b>credit / balance, payment status and the API key</b>. Until it is fixed, no new Convozen call will be audited (Karta, Welcome and Bajaj are not affected).</p>
         <p style="font-size:12px;color:#6b7280;">Error seen: ${sample}</p>`,
      ),
    );
  }
  await Promise.all(rows.map((r) =>
    db.from("audits").update({ error_message: `${r.error_message} ${FAIL_MARK}` }).eq("id", r.id),
  ));
  return { failed: rows.length, alerted: !alreadyTold };
}
