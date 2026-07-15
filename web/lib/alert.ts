import { createAdminClient } from "@/lib/supabase/admin";
import { parseEmails } from "@/lib/report";

const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL || "https://call-auditor-steel.vercel.app";

export async function sendLowScoreAlert(opts: {
  auditId: string;
  agentName: string;
  score: number; // 1–5 scale
  recommendations: string[];
}): Promise<void> {
  const supabase = createAdminClient();

  const { data: settings } = await supabase
    .from("report_settings")
    .select("emails")
    .limit(1)
    .maybeSingle();

  const recipients = parseEmails(settings?.emails);
  if (recipients.length === 0) return;

  const scorePercent = Math.round(opts.score * 20);
  const auditUrl = `${APP_URL}/audits/${opts.auditId}`;

  const recsList = opts.recommendations
    .slice(0, 5)
    .map((r) => `<li style="margin-bottom:6px">${r}</li>`)
    .join("");

  const html = `
<div style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto;padding:24px">
  <h2 style="color:#ef4444;margin-top:0">⚠️ Low Score Alert</h2>
  <p style="font-size:15px">
    Agent <strong>${opts.agentName}</strong> scored
    <strong style="color:#ef4444">${scorePercent}%</strong> (${opts.score}/5) on a recent call.
  </p>
  <p>
    <a href="${auditUrl}"
       style="display:inline-block;background:#111;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:600">
      View Full Audit →
    </a>
  </p>
  ${
    opts.recommendations.length > 0
      ? `<h3 style="margin-top:28px;font-size:14px;text-transform:uppercase;letter-spacing:.08em;color:#555">Top Areas to Improve</h3>
         <ul style="padding-left:20px;font-size:14px;line-height:1.6;color:#333">${recsList}</ul>`
      : ""
  }
  <p style="color:#aaa;font-size:11px;margin-top:32px;border-top:1px solid #eee;padding-top:16px">
    Sent automatically by Otis AI Call Auditor
  </p>
</div>`;

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
      to: recipients.join(", "),
      subject: `⚠️ Low Score Alert — ${opts.agentName} scored ${scorePercent}%`,
      html,
    });
    return;
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey || !from) return;

  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: recipients,
      subject: `⚠️ Low Score Alert — ${opts.agentName} scored ${scorePercent}%`,
      html,
    }),
  });
}
