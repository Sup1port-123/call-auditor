"use client";

import { useState } from "react";
import type { ReportSettings } from "@/lib/report";

export default function SettingsForm({
  initial,
  cronUrl,
}: {
  initial: ReportSettings | null;
  cronUrl: string;
}) {
  const [emails, setEmails] = useState(initial?.emails ?? "");
  const [sendTime, setSendTime] = useState(initial?.send_time ?? "21:00");
  const [enabled, setEnabled] = useState(initial?.enabled ?? false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(
    null,
  );

  async function save() {
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch("/api/report-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emails, send_time: sendTime, enabled }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not save");
      setMsg({ tone: "ok", text: "Saved." });
    } catch (err) {
      setMsg({ tone: "err", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setSaving(false);
    }
  }

  async function sendTest() {
    setTesting(true);
    setMsg(null);
    try {
      const res = await fetch("/api/report-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ test: true, emails }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not send test");
      setMsg({
        tone: "ok",
        text: `Test sent — ${data.count} audit${data.count === 1 ? "" : "s"} for ${data.date}. Check the inbox.`,
      });
    } catch (err) {
      setMsg({ tone: "err", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="space-y-7">
      <Field index="01" label="Recipient emails" hint="Comma-separated. The report is sent to all of them.">
        <input
          type="text"
          value={emails}
          onChange={(e) => setEmails(e.target.value)}
          placeholder="ops@gromo.in, lead@gromo.in"
          className="w-full rounded-2xl bg-[var(--paper)] border border-transparent focus:border-[var(--sky-500)] focus:bg-white px-5 py-3 text-sm focus:outline-none transition"
        />
      </Field>

      <Field index="02" label="Send time (IST)" hint="Each day, the report goes out at the first check at or after this time.">
        <input
          type="time"
          value={sendTime}
          onChange={(e) => setSendTime(e.target.value)}
          className="rounded-2xl bg-[var(--paper)] border border-transparent focus:border-[var(--sky-500)] focus:bg-white px-5 py-3 text-sm focus:outline-none transition"
        />
      </Field>

      <Field index="03" label="Automated daily email">
        <button
          type="button"
          onClick={() => setEnabled((v) => !v)}
          className={`relative inline-flex h-7 w-12 items-center rounded-full transition ${
            enabled ? "bg-emerald-500" : "bg-zinc-300"
          }`}
        >
          <span
            className={`inline-block h-5 w-5 transform rounded-full bg-white transition ${
              enabled ? "translate-x-6" : "translate-x-1"
            }`}
          />
        </button>
        <span className="ml-3 text-sm text-zinc-600">
          {enabled ? "On — sends every day" : "Off"}
        </span>
      </Field>

      {msg && (
        <div
          className={`rounded-2xl border px-5 py-3 text-sm ${
            msg.tone === "ok"
              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
              : "border-rose-200 bg-rose-50 text-rose-700"
          }`}
        >
          {msg.text}
        </div>
      )}

      <div className="flex gap-3">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="rounded-full bg-[var(--ink)] text-white px-7 py-3 text-sm font-medium hover:bg-zinc-800 transition disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={sendTest}
          disabled={testing}
          className="rounded-full bg-[var(--paper)] text-[var(--ink)] px-7 py-3 text-sm font-medium hover:bg-[var(--paper-strong)] transition disabled:opacity-50"
        >
          {testing ? "Sending…" : "Send test now"}
        </button>
      </div>

      <div className="rounded-2xl bg-[var(--paper)] p-6 mt-6">
        <div className="font-display text-sm font-bold mb-2">
          One-time setup (so the daily send actually fires)
        </div>
        <ol className="list-decimal pl-5 space-y-2 text-sm text-zinc-600 leading-relaxed">
          <li>
            In Vercel, set <code className="text-xs">CRON_SECRET</code> (any
            random string) and an email transport — either{" "}
            <code className="text-xs">SMTP_USER</code> +{" "}
            <code className="text-xs">SMTP_PASS</code> (a Gmail address + its
            16-char app password), or{" "}
            <code className="text-xs">RESEND_API_KEY</code> with a verified
            domain. Set <code className="text-xs">REPORT_FROM_EMAIL</code> to the
            sending address.
          </li>
          <li>
            Create a free job at <strong>cron-job.org</strong> that requests this
            URL every 15 minutes (replace <code className="text-xs">YOUR_CRON_SECRET</code>):
            <pre className="mt-2 rounded-xl bg-white p-3 text-xs overflow-x-auto whitespace-pre-wrap break-all">
              {cronUrl}
            </pre>
          </li>
          <li>
            Use <strong>Send test now</strong> above to confirm the email
            arrives before relying on the schedule.
          </li>
        </ol>
      </div>
    </div>
  );
}

function Field({
  index,
  label,
  hint,
  children,
}: {
  index: string;
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-baseline gap-2 mb-2">
        <span className="font-mono text-xs text-zinc-400">({index})</span>
        <label className="text-sm font-medium text-[var(--ink)]">{label}</label>
      </div>
      {children}
      {hint && <p className="text-xs text-zinc-500 mt-2">{hint}</p>}
    </div>
  );
}
