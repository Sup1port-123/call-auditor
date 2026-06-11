import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { newAgentId } from "@/lib/types/agent";
import {
  resolveKnowledgeBase,
  sanitizeText,
  rubricJsonFromForm,
} from "@/lib/agent-kb";

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

    const name = sanitizeText(String(form.get("name") ?? "").trim());
    const target = sanitizeText(String(form.get("target") ?? "").trim());
    const externalKeys = sanitizeText(
      String(form.get("external_keys") ?? "").trim(),
    );

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
      rubric_json: rubricJsonFromForm(form),
      external_keys: externalKeys || null,
      created_at: new Date().toISOString(),
    });

    if (error) {
      console.error("[otis] agent insert failed:", error.message);
      return NextResponse.json(
        { error: `Could not save agent: ${error.message} [${diag}]` },
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
