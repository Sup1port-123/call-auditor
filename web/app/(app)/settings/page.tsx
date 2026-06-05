import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import type { ReportSettings } from "@/lib/report";
import SettingsForm from "./settings-form";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function SettingsPage() {
  const supabase = await createClient();
  const { data: settings } = await supabase
    .from("report_settings")
    .select("*")
    .eq("id", "default")
    .maybeSingle<ReportSettings>();

  const h = await headers();
  const host = h.get("host") ?? "your-app.vercel.app";
  const proto = host.includes("localhost") ? "http" : "https";
  const cronUrl = `${proto}://${host}/api/cron/daily-report?key=YOUR_CRON_SECRET`;

  return (
    <div className="px-10 lg:px-16 py-14 max-w-3xl">
      <div className="text-xs uppercase tracking-[0.25em] text-[var(--sky-700)] font-semibold mb-3">
        Settings
      </div>
      <h1 className="font-display text-4xl md:text-5xl font-extrabold tracking-tight leading-[1.02] mb-3">
        Daily email report
      </h1>
      <p className="text-zinc-500 mb-10 max-w-xl">
        Email the day&apos;s audit report — the same Excel you download from the
        dashboard — automatically, every day, in IST.
      </p>

      <SettingsForm initial={settings} cronUrl={cronUrl} />
    </div>
  );
}
