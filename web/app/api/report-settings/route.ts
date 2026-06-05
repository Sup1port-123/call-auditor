import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  generateAndSendReport,
  istParts,
  parseEmails,
  parseHHMM,
} from "@/lib/report";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET() {
  try {
    const supabase = createAdminClient();
    const { data } = await supabase
      .from("report_settings")
      .select("*")
      .eq("id", "default")
      .maybeSingle();
    return NextResponse.json({ settings: data ?? null });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      emails?: string;
      send_time?: string;
      enabled?: boolean;
      test?: boolean;
    };

    const emails = parseEmails(body.emails);

    // "Send test now" — emails today's report immediately, ignoring schedule.
    if (body.test) {
      if (emails.length === 0) {
        return NextResponse.json(
          { error: "Add at least one valid email first." },
          { status: 400 },
        );
      }
      const { date } = istParts();
      const { count } = await generateAndSendReport({ emails, istDate: date });
      return NextResponse.json({ tested: true, count, date });
    }

    // Save settings.
    const send_time =
      parseHHMM(body.send_time) != null ? body.send_time!.trim() : null;

    const supabase = createAdminClient();
    const { error } = await supabase.from("report_settings").upsert({
      id: "default",
      emails: emails.join(", ") || null,
      send_time,
      enabled: !!body.enabled,
      timezone: "IST",
      updated_at: new Date().toISOString(),
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[otis] report-settings crashed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
