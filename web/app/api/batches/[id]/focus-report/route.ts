// GET  /api/batches/[id]/focus-report → cached Special Audit Focus Report (builds it if missing/stale)
// POST /api/batches/[id]/focus-report → force a rebuild (one LLM call)

import { NextResponse } from "next/server";
import { getOrBuildBatchFocusReport } from "@/lib/batch-focus";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

async function handle(id: string, force: boolean) {
  try {
    const report = await getOrBuildBatchFocusReport(id, { force });
    if (!report) {
      return NextResponse.json(
        { report: null, message: "This batch has no audit focus, or no focus answers yet." },
        { status: 200 },
      );
    }
    return NextResponse.json({ report });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handle(id, false);
}

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handle(id, true);
}
