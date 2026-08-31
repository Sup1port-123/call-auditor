// app/api/batches/[id]/trash/route.ts
//
// Handles soft-delete, restore, and permanent destroy for a single batch.
// Admin-only: the caller's Supabase session email must match ADMIN_EMAIL.
//
// POST /api/batches/[id]/trash   { action: "trash" | "restore" | "destroy" }

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

type Action = "trash" | "restore" | "destroy";

export async function POST(
  req: Request,
  { params }: { params: { id: string } }
) {
  // 1. Auth: get the current user from the request session
  const supabase = await createClient();
  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser();

  if (authErr || !user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  // 2. Admin check: only the designated admin email may delete/restore
  const adminEmail = process.env.ADMIN_EMAIL ?? "";
  if (!adminEmail || user.email !== adminEmail) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // 3. Parse action from request body
  let action: Action;
  try {
    const body = await req.json();
    action = body.action;
    if (!["trash", "restore", "destroy"].includes(action)) {
      throw new Error("invalid action");
    }
  } catch {
    return NextResponse.json(
      { error: 'action must be "trash", "restore", or "destroy"' },
      { status: 400 }
    );
  }

  const batchId = params.id;
  const admin = createAdminClient();

  // 4. Execute
  if (action === "trash") {
    const { error } = await admin
      .from("batches")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", batchId)
      .is("deleted_at", null);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true, action: "trashed" });
  }

  if (action === "restore") {
    const { error } = await admin
      .from("batches")
      .update({ deleted_at: null })
      .eq("id", batchId);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true, action: "restored" });
  }

  if (action === "destroy") {
    const { error: auditErr } = await admin
      .from("audits")
      .delete()
      .eq("batch_id", batchId);

    if (auditErr) {
      return NextResponse.json({ error: auditErr.message }, { status: 500 });
    }

    const { error: batchErr } = await admin
      .from("batches")
      .delete()
      .eq("id", batchId);

    if (batchErr) {
      return NextResponse.json({ error: batchErr.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, action: "destroyed" });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
