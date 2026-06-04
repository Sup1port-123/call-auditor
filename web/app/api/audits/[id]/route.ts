import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isReviewStatus } from "@/lib/types/audit";

export const runtime = "nodejs";

// Update an audit's manual review state (reviewed / not_reviewed / flagged).
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: "Missing audit id" }, { status: 400 });
    }

    const body = await req.json().catch(() => ({}));
    const status = (body as { review_status?: unknown }).review_status;
    if (!isReviewStatus(status)) {
      return NextResponse.json(
        { error: "review_status must be reviewed, not_reviewed, or flagged" },
        { status: 400 },
      );
    }

    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from("audits")
      .update({ review_status: status })
      .eq("id", id)
      .select("id")
      .maybeSingle();

    if (error) {
      console.error("[otis] review update failed:", error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ error: "Audit not found" }, { status: 404 });
    }

    return NextResponse.json({ id, review_status: status });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[otis] /api/audits/[id] crashed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
