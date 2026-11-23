import { NextResponse } from "next/server";
import { checkCriticalAudits } from "@/lib/alerts";

export const runtime = "nodejs";
export const maxDuration = 60;

// Emails an alert when an audited call shows the agent sharing wrong or risky
// information. The Apps Script trigger `alertsNow` calls this every 15 minutes:
//   GET /api/cron/alerts?key=YOUR_CRON_SECRET
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const secret = process.env.CRON_SECRET;
    const authorized =
      !!secret &&
      (url.searchParams.get("key") === secret ||
        req.headers.get("authorization") === `Bearer ${secret}`);
    if (!authorized) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    return NextResponse.json(await checkCriticalAudits());
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[otis] alerts crashed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const POST = GET;
