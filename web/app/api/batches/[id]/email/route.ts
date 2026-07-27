import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseEmails } from "@/lib/report";

export const runtime = "nodejs";
export const maxDuration = 60;

async function sendEmail(opts: {
  to: string[];
  subject: string;
  html: string;
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
    await transport.sendMail({ from: from || smtpUser, to: opts.to.join(", "), subject: opts.subject, html: opts.html });
    return;
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("No email transport configured.");
  if (!from) throw new Error("REPORT_FROM_EMAIL is not set");

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: opts.to, subject: opts.subject, html: opts.html }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 300)}`);
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const { id } = params;
  const supabase = createAdminClient();

  // Fetch batch info
  const { data: batch } = await supabase
    .from("batches")
    .select("id, label, custom_focus")
    .eq("id", id)
    .maybeSingle();
  if (!batch) return NextResponse.json({ error: "batch not found" }, { status: 404 });

  // Fetch all audits for this batch
  const { data: audits } = await supabase
    .from("audits")
    .select("call_id, mobile_number, overall_score, summary, what_was_lacking, status, error_message")
    .eq("batch_id", id)
    .order("overall_score", { ascending: true, nullsFirst: false });

  // Get recipients from report_settings
  const { data: settings } = await supabase.from("report_settings").select("emails").maybeSingle();
  const recipients = parseEmails(settings?.emails);
  if (recipients.length === 0) return NextResponse.json({ skipped: "no recipients configured" });

  const rows = audits ?? [];
  const completed = rows.filter((r) => r.status === "completed");
  const failed = rows.filter((r) => r.status === "failed");
  const avgScore =
    completed.length > 0
      ? (completed.reduce((s, r) => s + (r.overall_score ?? 0), 0) / completed.length).toFixed(1)
      : "—";

  const scoreColor = (s: number | null) =>
    s == null ? "#888" : s >= 7 ? "#16a34a" : s >= 5 ? "#ca8a04" : "#dc2626";

  const auditRows = rows
    .map(
      (r) => `
    <tr style="border-bottom:1px solid #e5e7eb;">
      <td style="padding:8px 10px;font-size:13px;color:#555;">${r.call_id ?? "—"}</td>
      <td style="padding:8px 10px;font-size:13px;color:#555;">${r.mobile_number ?? "—"}</td>
      <td style="padding:8px 10px;text-align:center;font-weight:700;color:${scoreColor(r.overall_score)};">${r.overall_score ?? "—"}</td>
      <td style="padding:8px 10px;font-size:13px;color:#444;">${r.summary ?? (r.error_message ? `<span style="color:#dc2626;">${r.error_message}</span>` : "—")}</td>
      <td style="padding:8px 10px;font-size:13px;color:#dc2626;">${r.what_was_lacking ?? "—"}</td>
    </tr>`,
    )
    .join("");

  const focusBadge = (batch as any).custom_focus
    ? `<span style="background:#fef3c7;color:#92400e;border:1px solid #fde68a;border-radius:999px;padding:2px 10px;font-size:12px;font-weight:600;">Focus: ${(batch as any).custom_focus}</span>`
    : "";

  const html = `
<div style="font-family:system-ui,sans-serif;max-width:900px;margin:0 auto;padding:24px;">
  <h1 style="font-size:22px;font-weight:800;color:#111;margin:0 0 4px 0;">
    ${batch.label || "Batch"} — Audit Complete
  </h1>
  <div style="margin:8px 0 20px 0;">${focusBadge}</div>
  <div style="display:flex;gap:24px;margin-bottom:24px;flex-wrap:wrap;">
    <div style="background:#f9fafb;border-radius:12px;padding:14px 20px;min-width:120px;">
      <div style="font-size:12px;color:#888;text-transform:uppercase;letter-spacing:0.1em;">Total</div>
      <div style="font-size:28px;font-weight:800;color:#111;">${rows.length}</div>
    </div>
    <div style="background:#ecfdf5;border-radius:12px;padding:14px 20px;min-width:120px;">
      <div style="font-size:12px;color:#888;text-transform:uppercase;letter-spacing:0.1em;">Completed</div>
      <div style="font-size:28px;font-weight:800;color:#16a34a;">${completed.length}</div>
    </div>
    <div style="background:#fef2f2;border-radius:12px;padding:14px 20px;min-width:120px;">
      <div style="font-size:12px;color:#888;text-transform:uppercase;letter-spacing:0.1em;">Failed</div>
      <div style="font-size:28px;font-weight:800;color:#dc2626;">${failed.length}</div>
    </div>
    <div style="background:#f0fdf4;border-radius:12px;padding:14px 20px;min-width:120px;">
      <div style="font-size:12px;color:#888;text-transform:uppercase;letter-spacing:0.1em;">Avg Score</div>
      <div style="font-size:28px;font-weight:800;color:#16a34a;">${avgScore}</div>
    </div>
  </div>
  <h2 style="font-size:15px;font-weight:700;color:#111;margin:0 0 8px 0;">Per-Call Breakdown</h2>
  <table style="width:100%;border-collapse:collapse;font-size:14px;background:#fff;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
    <thead>
      <tr style="background:#f3f4f6;text-align:left;">
        <th style="padding:9px 10px;">Call ID</th>
        <th style="padding:9px 10px;">Mobile</th>
        <th style="padding:9px 10px;text-align:center;">Score</th>
        <th style="padding:9px 10px;">Summary</th>
        <th style="padding:9px 10px;color:#dc2626;">What Was Lacking</th>
      </tr>
    </thead>
    <tbody>${auditRows}</tbody>
  </table>
  <p style="color:#aaa;font-size:11px;margin-top:20px;">Sent automatically by Otis when the batch completed.</p>
</div>`;

  try {
    await sendEmail({
      to: recipients,
      subject: `Otis batch complete — ${batch.label || id} (${completed.length}/${rows.length} scored)`,
      html,
    });
    return NextResponse.json({ sent: true, recipients: recipients.length, audits: rows.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
