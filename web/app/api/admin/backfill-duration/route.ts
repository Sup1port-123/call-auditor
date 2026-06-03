import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAssemblyClient } from "@/lib/auditor";

export const runtime = "nodejs";
export const maxDuration = 60;

// One-time (repeatable) backfill of audits.duration_seconds for rows that
// predate the column. Call it after running the duration migration:
//
//   POST /api/admin/backfill-duration            (25 rows per call)
//   POST /api/admin/backfill-duration?limit=40
//
// It's idempotent — only touches rows where duration_seconds IS NULL — and
// returns `remaining`, so keep calling until that hits 0.
//
// Two sources, in order of accuracy:
//   1. AssemblyAI audio_duration via the stored transcript_id (true length).
//   2. The last [mm:ss] timestamp in the saved transcript text (approx, for
//      rows that never stored a transcript_id).

function durationFromTranscript(text: string | null): number | null {
  if (!text) return null;
  // Find the largest [mm:ss] marker — utterances are in order, so the last
  // one is the closest floor we have for the recording length.
  let best: number | null = null;
  const re = /\[(\d{1,2}):(\d{2})\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const secs = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
    if (best == null || secs > best) best = secs;
  }
  return best;
}

export async function POST(req: Request) {
  try {
    const url = new URL(req.url);
    const limit = Math.min(
      Math.max(parseInt(url.searchParams.get("limit") ?? "25", 10) || 25, 1),
      100,
    );

    const supabase = createAdminClient();

    // Total still missing, for progress reporting.
    const { count: remainingBefore } = await supabase
      .from("audits")
      .select("id", { count: "exact", head: true })
      .is("duration_seconds", null);

    const { data: rows, error } = await supabase
      .from("audits")
      .select("id, transcript_id, transcript")
      .is("duration_seconds", null)
      .order("timestamp", { ascending: false })
      .limit(limit);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!rows || rows.length === 0) {
      return NextResponse.json({ processed: 0, updated: 0, remaining: 0 });
    }

    const assembly = getAssemblyClient();
    let updated = 0;

    for (const row of rows) {
      let seconds: number | null = null;

      if (row.transcript_id) {
        try {
          const t = (await assembly.transcripts.get(row.transcript_id)) as {
            audio_duration?: number | null;
          };
          if (typeof t.audio_duration === "number" && t.audio_duration >= 0) {
            seconds = Math.round(t.audio_duration);
          }
        } catch {
          // Transcript gone / unreachable — fall through to text parsing.
        }
      }

      if (seconds == null) {
        seconds = durationFromTranscript(row.transcript);
      }

      // Write -1 as a sentinel "couldn't determine" so we don't keep
      // re-fetching this row forever. It's excluded from duration filters.
      const value = seconds == null ? -1 : seconds;
      const { error: upErr } = await supabase
        .from("audits")
        .update({ duration_seconds: value })
        .eq("id", row.id);
      if (!upErr && seconds != null) updated++;
    }

    const remaining = Math.max((remainingBefore ?? rows.length) - rows.length, 0);

    return NextResponse.json({
      processed: rows.length,
      updated,
      remaining,
      hint:
        remaining > 0
          ? "Call this endpoint again to continue."
          : "Backfill complete.",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[otis] backfill-duration crashed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// Allow GET too, so it can be kicked off from a browser address bar.
export const GET = POST;
