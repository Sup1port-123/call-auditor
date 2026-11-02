import { createAdminClient } from "@/lib/supabase/admin";
import { fileExtension } from "@/lib/upload-formats";

// Uploaded recordings go straight from the browser to Supabase Storage (Vercel
// caps function request bodies at 4.5 MB, too small for most calls). The
// bucket is private; transcription providers read the file via a signed URL.
export const CALL_UPLOADS_BUCKET = "call-uploads";

// How long the signed recording link stored on the audit stays playable.
const SIGNED_URL_SECONDS = 60 * 60 * 24 * 30;

export async function ensureCallUploadsBucket(): Promise<void> {
  const supabase = createAdminClient();
  const { data } = await supabase.storage.getBucket(CALL_UPLOADS_BUCKET);
  if (data) return;
  const { error } = await supabase.storage.createBucket(CALL_UPLOADS_BUCKET, { public: false });
  if (error && !/already exists/i.test(error.message)) {
    throw new Error(`Could not create storage bucket: ${error.message}`);
  }
}

export function uploadPathFor(fileName: string): string {
  const ext = fileExtension(fileName);
  const base = fileName
    .slice(0, ext ? -(ext.length + 1) : undefined)
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .slice(0, 80) || "recording";
  const day = new Date().toISOString().slice(0, 10);
  const rand = Math.random().toString(16).slice(2, 10);
  return `${day}/${rand}-${base}${ext ? `.${ext}` : ""}`;
}

export async function signedRecordingUrl(path: string): Promise<string> {
  const supabase = createAdminClient();
  const { data, error } = await supabase.storage
    .from(CALL_UPLOADS_BUCKET)
    .createSignedUrl(path, SIGNED_URL_SECONDS);
  if (error || !data) {
    throw new Error(`Uploaded file not found: ${error?.message ?? "unknown error"}`);
  }
  return data.signedUrl;
}
