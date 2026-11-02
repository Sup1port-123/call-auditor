import { NextResponse } from "next/server";
import { signedRecordingUrl } from "@/lib/call-uploads";
import { startRecordingAudit } from "@/lib/start-audit";

export const runtime = "nodejs";
export const maxDuration = 60;

// Start an audit for a recording the browser already uploaded to storage.
export async function POST(req: Request) {
  let body: {
    path?: string;
    agent_id?: string | null;
    preset?: string;
    strictness?: string;
    custom_focus?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const path = body.path?.trim();
  if (!path) {
    return NextResponse.json({ error: "path is required" }, { status: 400 });
  }

  let audioUrl: string;
  try {
    audioUrl = await signedRecordingUrl(path);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 404 });
  }

  const result = await startRecordingAudit({
    ...body,
    audioUrl,
    origin: new URL(req.url).origin,
  });
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ id: result.id });
}
