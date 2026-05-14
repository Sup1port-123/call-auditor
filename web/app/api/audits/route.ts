import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { submitTranscription } from "@/lib/auditor";

export const runtime = "nodejs";

function newAuditId(): string {
  const d = new Date();
  const stamp =
    d.toISOString().slice(0, 19).replace(/[-:T]/g, "").replace("T", "-");
  return `${stamp}-${Math.random().toString(16).slice(2, 8)}`;
}

function originFromRequest(req: Request): string {
  const url = new URL(req.url);
  return url.origin;
}

export async function POST(req: Request) {
  let body: {
    audio_url?: string;
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

  const id = newAuditId();
  const supabase = createAdminClient();

  const { error: insertErr } = await supabase.from("audits").insert({
    id,
    timestamp: new Date().toISOString(),
    source: "next-app",
    target: audioUrl,
    preset: body.preset || "general",
    strictness: body.strictness || "standard",
    custom_focus: body.custom_focus || "",
    status: "transcribing",
  });

  if (insertErr) {
    return NextResponse.json(
      { error: `Could not create audit row: ${insertErr.message}` },
      { status: 500 },
    );
  }

  try {
    const webhookUrl = `${originFromRequest(req)}/api/audits/webhook`;
    const { transcriptId } = await submitTranscription({
      audioUrl,
      webhookUrl,
      auditId: id,
    });
    await supabase
      .from("audits")
      .update({ transcript_id: transcriptId })
      .eq("id", id);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await supabase
      .from("audits")
      .update({ status: "failed", error_message: message })
      .eq("id", id);
    return NextResponse.json(
      { error: `AssemblyAI submission failed: ${message}` },
      { status: 502 },
    );
  }

  return NextResponse.json({ id });
}
