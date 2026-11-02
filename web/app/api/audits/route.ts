import { NextResponse } from "next/server";
import { startRecordingAudit } from "@/lib/start-audit";

export const runtime = "nodejs";

export async function POST(req: Request) {
  let body: {
    audio_url?: string;
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

  const audioUrl = body.audio_url?.trim();
  if (!audioUrl) {
    return NextResponse.json(
      { error: "audio_url is required" },
      { status: 400 },
    );
  }
  if (!/^https?:\/\//i.test(audioUrl)) {
    return NextResponse.json(
      { error: "audio_url must be an http(s) URL" },
      { status: 400 },
    );
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
