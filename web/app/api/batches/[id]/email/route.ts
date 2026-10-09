import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import nodemailer from "nodemailer";

const RECIPIENTS = [
  "sameer.singh@gromo.in",
  "anjali.munja@gromo.in",
  "Vijay.Parkash@gromo.in",
];

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

export async function POST(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const batchId = params.id;
  const supabase = createAdminClient();

  const { data: audits, error } = await supabase
    .from("audits")
    .select("call_id, mobile_number, overall_score, compliance_json, summary, what_was_lacking")
    .eq("batch_id", batchId)
    .order("overall_score", { ascending: true });

  if (error || !audits) {
    return NextResponse.json({ error: "Failed to fetch audits" }, { status: 500 });
  }

  const total = audits.length;
  const completed = audits.filter((a) => a.overall_score !== null).length;
  const failed = total - completed;
  const avgScore =
    total > 0
      ? Math.round((audits.reduce((s, a) => s + (a.overall_score ?? 0), 0) / total) * 20)
      : 0;

  const rows = audits.map((a) => {
    const qPct = Math.round((a.overall_score ?? 0) * 20);
    const color = qPct >= 70 ? "#2e7d32" : qPct >= 50 ? "#e65100" : "#c62828";
    let tagPass = 0, tagTotal = 0;
    try {
      const c = JSON.parse(a.compliance_json ?? "{}");
      const keys = Object.keys(c);
      tagTotal = keys.length;
      tagPass = keys.filter((k) => c[k]?.passed).length;
    } catch {}
    const tagAccuracy = tagTotal > 0 ? `${tagPass}/${tagTotal}` : "N/A";
    const summary = (a.summary ?? "").substring(0, 130);
    const lacking = (a.what_was_lacking ?? "").substring(0, 110);
    return `
      <tr>
        <td style="padding:6px 8px;font-size:11px;border-bottom:1px solid #eee;font-family:monospace;color:#555">${a.call_id ?? ""}</td>
        <td style="padding:6px 8px;font-size:12px;border-bottom:1px solid #eee">${a.mobile_number ?? ""}</td>
        <td style="padding:6px 8px;font-size:13px;border-bottom:1px solid #eee;text-align:center;font-weight:bold;color:${color}">${qPct}%</td>
        <td style="padding:6px 8px;font-size:12px;border-bottom:1px solid #eee;text-align:center">${tagAccuracy}</td>
        <td style="padding:6px 8px;font-size:11px;border-bottom:1px solid #eee;color:#333;max-width:280px">${summary}</td>
        <td style="padding:6px 8px;font-size:11px;border-bottom:1px solid #eee;color:#c62828;max-width:220px">${lacking}</td>
      </tr>`;
  }).join("");

  const d = batchId.substring(0, 8);
  const dateStr = `${d.substring(6, 8)} ${MONTHS[parseInt(d.substring(4, 6)) - 1]} ${d.substring(0, 4)}`;

  const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,sans-serif">
<div style="max-width:1100px;margin:0 auto;padding:24px">
  <h2 style="margin:0 0 4px;font-size:22px;color:#1a1a1a">Convozen — Audit Complete</h2>
  <p style="margin:0 0 20px;color:#666;font-size:13px">Daily quality report · ${dateStr}</p>
  <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px">
    <tr>
      <td style="width:25%;padding:4px"><div style="border:1px solid #e5e7eb;border-radius:10px;padding:16px;text-align:center;background:#fff"><div style="font-size:11px;color:#6b7280;text-transform:uppercase;margin-bottom:6px">TOTAL</div><div style="font-size:30px;font-weight:800;color:#6366f1">${total}</div></div></td>
      <td style="width:25%;padding:4px"><div style="border:1px solid #e5e7eb;border-radius:10px;padding:16px;text-align:center;background:#fff"><div style="font-size:11px;color:#6b7280;text-transform:uppercase;margin-bottom:6px">COMPLETED</div><div style="font-size:30px;font-weight:800;color:#16a34a">${completed}</div></div></td>
      <td style="width:25%;padding:4px"><div style="border:1px solid #e5e7eb;border-radius:10px;padding:16px;text-align:center;background:#fff"><div style="font-size:11px;color:#6b7280;text-transform:uppercase;margin-bottom:6px">FAILED</div><div style="font-size:30px;font-weight:800;color:#dc2626">${failed}</div></div></td>
      <td style="width:25%;padding:4px"><div style="border:1px solid #e5e7eb;border-radius:10px;padding:16px;text-align:center;background:#fff"><div style="font-size:11px;color:#6b7280;text-transform:uppercase;margin-bottom:6px">AVG QUALITY</div><div style="font-size:30px;font-weight:800;color:#ca8a04">${avgScore}%</div></div></td>
    </tr>
  </table>
  <div style="background:#fff;border-radius:10px;border:1px solid #e5e7eb;overflow:hidden">
    <table width="100%" cellpadding="0" cellspacing="0">
      <thead><tr style="background:#f9fafb;border-bottom:2px solid #e5e7eb">
        <th style="padding:10px 8px;font-size:11px;text-align:left;color:#6b7280;text-transform:uppercase">Call ID</th>
        <th style="padding:10px 8px;font-size:11px;text-align:left;color:#6b7280;text-transform:uppercase">Mobile</th>
        <th style="padding:10px 8px;font-size:11px;text-align:center;color:#6b7280;text-transform:uppercase">Quality %</th>
        <th style="padding:10px 8px;font-size:11px;text-align:center;color:#6b7280;text-transform:uppercase">Tag Accuracy</th>
        <th style="padding:10px 8px;font-size:11px;text-align:left;color:#6b7280;text-transform:uppercase">Summary</th>
        <th style="padding:10px 8px;font-size:11px;text-align:left;color:#c62828;text-transform:uppercase">What Was Lacking</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>
  <p style="font-size:11px;color:#9ca3af;text-align:center;margin-top:16px">Otis AI Auditor · ${batchId} · Sent automatically on completion</p>
</div></body></html>`;

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST ?? "smtp-relay.brevo.com",
    port: 587,
    secure: false,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });

  await transporter.sendMail({
    from: `"Otis AI Auditor" <${process.env.SMTP_USER}>`,
    to: RECIPIENTS,
    subject: `Convozen — Audit Complete · ${dateStr}`,
    html,
  });

  return NextResponse.json({ sent: true, recipients: RECIPIENTS.length, audits: total });
    }
