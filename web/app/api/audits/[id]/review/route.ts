import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

// PATCH /api/audits/:id/review  { reviewed: true }  → clears the flag
// PATCH /api/audits/:id/review  { reviewed: false } → re-raises the flag
export async function PATCH(
  req: Request,
  { params }: { params: { id: string } },
) {
  const supabase = createAdminClient();
  const { id } = params;

  let body: { reviewed?: boolean };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const clearing = body.reviewed === true;

  const { error } = await supabase
    .from("audits")
    .update({
      needs_review: !clearing,
      reviewed_at: clearing ? new Date().toISOString() : null,
    })
    .eq("id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, needs_review: !clearing });
}

// PUT /api/audits/:id/review  { reason: "..." } → manually flag with custom reason
export async function PUT(
  req: Request,
  { params }: { params: { id: string } },
) {
  const supabase = createAdminClient();
  const { id } = params;

  let body: { reason?: string };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const { error } = await supabase
    .from("audits")
    .update({
      needs_review: true,
      review_reason: body.reason ?? "Manually flagged for review",
      reviewed_at: null,
    })
    .eq("id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, needs_review: true });
}
