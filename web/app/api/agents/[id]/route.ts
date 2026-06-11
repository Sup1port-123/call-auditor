import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  resolveKnowledgeBase,
  sanitizeText,
  rubricJsonFromForm,
} from "@/lib/agent-kb";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  // Whole handler wrapped so a crash still returns JSON, never an empty body.
  try {
    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: "Missing agent id" }, { status: 400 });
    }

    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return NextResponse.json(
        { error: "Expected multipart form data" },
        { status: 400 },
      );
    }

    const name = sanitizeText(String(form.get("name") ?? "").trim());
    const target = sanitizeText(String(form.get("target") ?? "").trim());

    if (!name) {
      return NextResponse.json(
        { error: "Agent name is required" },
        { status: 400 },
      );
    }

    const kbResult = await resolveKnowledgeBase(form);
    if (!kbResult.ok) {
      return NextResponse.json(
        { error: kbResult.error },
        { status: kbResult.status },
      );
    }
    const { kb: knowledgeBase, diag } = kbResult;

    let supabase;
    try {
      supabase = createAdminClient();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[otis] admin client failed:", message);
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

    const { data, error } = await supabase
      .from("agents")
      .update({
        name,
        target: target || null,
        knowledge_base: knowledgeBase || null,
        rubric_json: rubricJsonFromForm(form),
      })
      .eq("id", id)
      .select("id")
      .maybeSingle();

    if (error) {
      console.error("[otis] agent update failed:", error.message);
      return NextResponse.json(
        { error: `Could not save agent: ${error.message} [${diag}]` },
        { status: 500 },
      );
    }
    if (!data) {
      return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    }

    return NextResponse.json({ id });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[otis] /api/agents/[id] crashed:", message);
    return NextResponse.json(
      { error: `Unexpected server error: ${message}` },
      { status: 500 },
    );
  }
}
