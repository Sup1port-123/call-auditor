import { NextResponse } from "next/server";
import { extractText, getDocumentProxy } from "unpdf";
import { sanitizeText } from "@/lib/agent-kb";
import { startTranscriptAudit } from "@/lib/start-audit";
import { classifyUpload, fileExtension } from "@/lib/upload-formats";

export const runtime = "nodejs";
export const maxDuration = 60;

const MIN_WORDS = 30;

async function readTranscript(file: File): Promise<string> {
  const ext = fileExtension(file.name);
  if (ext === "pdf") {
    const doc = await getDocumentProxy(new Uint8Array(await file.arrayBuffer()));
    const { text } = await extractText(doc, { mergePages: true });
    return Array.isArray(text) ? text.join("\n") : text;
  }
  if (ext === "docx") {
    const mammoth = await import("mammoth");
    const { value } = await mammoth.extractRawText({ buffer: Buffer.from(await file.arrayBuffer()) });
    return value;
  }
  return file.text();
}

// Audit a call from an already-written transcript (.txt, .pdf, .docx, …).
export async function POST(req: Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Expected a file upload" }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }
  if (classifyUpload(file.name, file.type) !== "transcript") {
    return NextResponse.json({ error: "Only transcript files (.txt, .pdf, .docx, …) can be uploaded here." }, { status: 400 });
  }

  let transcript: string;
  try {
    transcript = sanitizeText(await readTranscript(file))
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Could not read ${file.name}: ${message}` }, { status: 422 });
  }

  if (transcript.split(/\s+/).filter(Boolean).length < MIN_WORDS) {
    return NextResponse.json(
      { error: `${file.name} has too little text to audit (needs at least ${MIN_WORDS} words). Scanned PDFs without a text layer can't be read.` },
      { status: 422 },
    );
  }

  const result = await startTranscriptAudit({
    transcript,
    fileName: file.name,
    agent_id: String(form.get("agent_id") ?? "") || null,
    preset: String(form.get("preset") ?? ""),
    strictness: String(form.get("strictness") ?? ""),
    custom_focus: String(form.get("custom_focus") ?? ""),
  });
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ id: result.id });
}
