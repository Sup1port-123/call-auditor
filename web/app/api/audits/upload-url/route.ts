import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { CALL_UPLOADS_BUCKET, ensureCallUploadsBucket, uploadPathFor } from "@/lib/call-uploads";
import { classifyUpload } from "@/lib/upload-formats";

export const runtime = "nodejs";

// Hands the browser a one-time signed URL to upload a recording directly to
// Supabase Storage.
export async function POST(req: Request) {
  let body: { file_name?: string; mime_type?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const fileName = body.file_name?.trim();
  if (!fileName) {
    return NextResponse.json({ error: "file_name is required" }, { status: 400 });
  }
  if (classifyUpload(fileName, body.mime_type) !== "recording") {
    return NextResponse.json({ error: "Only audio or video recordings can be uploaded here." }, { status: 400 });
  }

  try {
    await ensureCallUploadsBucket();
    const path = uploadPathFor(fileName);
    const { data, error } = await createAdminClient()
      .storage.from(CALL_UPLOADS_BUCKET)
      .createSignedUploadUrl(path);
    if (error || !data) throw new Error(error?.message ?? "no upload URL returned");
    return NextResponse.json({ bucket: CALL_UPLOADS_BUCKET, path: data.path, token: data.token });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Could not prepare upload: ${message}` }, { status: 500 });
  }
}
