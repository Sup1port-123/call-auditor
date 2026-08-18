// web/app/api/audits/[id]/review/route.ts
// PATCH /api/audits/:id/review
//   body: { reviewed: true }   → clears the flag (marks human has reviewed it)
//   body: { reviewed: false }  → re-raises the flag (undo)
//
// PUT  /api/audits/:id/review
//   body: { reason: "..." }    → manually flag an audit with a custom reason

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function PATCH(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const supabase = createAdminClient();
  const { id } = await context.params;

  let body: { reviewed?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const clearing = body.reviewed === true;

  const { error } = await supabase
    .from("audits")
    .update({
      needs_review: !clearing,
      reviewed_at: clearing ? new Date().toISOString() : null,
    })
    .eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, needs_review: !clearing });
}

export async function PUT(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const supabase = createAdminClient();
  const { id } = await context.params;

  let body: { reason?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { error } = await supabase
    .from("audits")
    .update({
      needs_review: true,
      review_reason: body.reason ?? "Manually flagged for review",
      reviewed_at: null,
    })
    .eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, needs_review: true });
}
