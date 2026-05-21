import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export type BatchCounts = {
  queued: number;
  transcribing: number;
  scoring: number;
  completed: number;
  failed: number;
  total: number;
  done: boolean;
};

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("audits")
    .select("status")
    .eq("batch_id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const counts: BatchCounts = {
    queued: 0,
    transcribing: 0,
    scoring: 0,
    completed: 0,
    failed: 0,
    total: data?.length ?? 0,
    done: false,
  };

  for (const row of data ?? []) {
    const s = (row.status ?? "") as keyof BatchCounts;
    if (s in counts && s !== "total" && s !== "done") {
      counts[s] += 1;
    }
  }
  counts.done =
    counts.total > 0 &&
    counts.queued === 0 &&
    counts.transcribing === 0 &&
    counts.scoring === 0;

  return NextResponse.json(counts, {
    headers: { "Cache-Control": "no-store" },
  });
}
