import { NextResponse } from "next/server";
import { extractText, getDocumentProxy } from "unpdf";
import { createAdminClient } from "@/lib/supabase/admin";
import { newAgentId } from "@/lib/types/agent";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  // Whole handler wrapped so a crash still returns JSON, never an empty body.
  try {
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return NextResponse.json(
        { error: "Expected multipart form data" },
        { status: 400 },
      );
    }

    const name = String(form.get("name") ?? "").trim();
    const target = String(form.get("target") ?? "").trim();
    const kbMode = String(form.get("kb_mode") ?? "text");

    if (!name) {
      return NextResponse.json(
        { error: "Agent name is required" },
        { status: 400 },
      );
    }

    let knowledgeBase = "";

    if (kbMode === "pdf") {
      const pdf = form.get("pdf");
      if (!(pdf instanceof File)) {
        return NextResponse.json(
          { error: "No PDF file received" },
          { status: 400 },
        );
      }
      try {
        const buf = new Uint8Array(await pdf.arrayBuffer());
        const doc = await getDocumentProxy(buf);
        const { text } = await extractText(doc, { mergePages: true });
        knowledgeBase = (Array.isArray(text) ? text.join("\n") : text)
          .replace(/[ \t]+/g, " ")
          .replace(/\n{3,}/g, "\n\n")
          .trim();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("[otis] PDF extract failed:", message);
        return NextResponse.json(
          { error: `Could not read PDF: ${message}` },
          { status: 422 },
        );
      }
    } else {
      knowledgeBase = String(form.get("kb_text") ?? "").trim();
    }

    let supabase;
    try {
      supabase = createAdminClient();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[otis] admin client failed:", message);
      // Surface exactly which SUPABASE-prefixed env keys the running
      // function can actually see, so we stop guessing.
      const visible =
        Object.keys(process.env)
          .filter((k) => k.includes("SUPABASE"))
          .sort()
          .join(", ") || "(none)";
      return NextResponse.json(
        {
          error:
            `${message}. After adding it in Vercel you MUST redeploy. ` +
            `Env keys this deployment can see: ${visible}`,
        },
        { status: 500 },
      );
    }

    const id = newAgentId();
    const { error } = await supabase.from("agents").insert({
      id,
      name,
      target: target || null,
      description: null,
      knowledge_base: knowledgeBase || null,
      created_at: new Date().toISOString(),
    });

    if (error) {
      console.error("[otis] agent insert failed:", error.message);
      return NextResponse.json(
        { error: `Could not save agent: ${error.message}` },
        { status: 500 },
      );
    }

    return NextResponse.json({ id });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[otis] /api/agents crashed:", message);
    return NextResponse.json(
      { error: `Unexpected server error: ${message}` },
      { status: 500 },
    );
  }
}
