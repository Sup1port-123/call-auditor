import { NextResponse } from "next/server";
import { finalizeAudit } from "@/lib/finalize";

export const runtime = "nodejs";
export const maxDuration = 60;

// AssemblyAI calls this when a transcript finishes. We identify the audit
// via the x-audit-id header set at submission time, then hand off to
// finalizeAudit (which re-checks AssemblyAI and scores). The same logic
// runs from the status poller, so this webhook is a speed-up, not a
// hard dependency — if Vercel deployment protection blocks it, audits
// still complete via polling.
export async function POST(req: Request) {
  const auditId = req.headers.get("x-audit-id");
  if (!auditId) {
    return NextResponse.json(
      { error: "Missing x-audit-id header" },
      { status: 401 },
    );
  }
  try {
    const r = await finalizeAudit(auditId);
    return NextResponse.json({ ok: true, ...r });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[otis] webhook finalize failed:", message);
    // 200 so AssemblyAI doesn't retry-storm; the poller will recover it.
    return NextResponse.json({ ok: false, error: message });
  }
}
