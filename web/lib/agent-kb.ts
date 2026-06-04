import { extractText, getDocumentProxy } from "unpdf";
import { sanitizeRubric } from "./rubric";

// Read the `rubric` form field (a JSON string from the editor), validate it,
// and return the JSON string to store — or null to mean "use the built-in
// default rubric". Shared by the agent create + update routes.
export function rubricJsonFromForm(form: FormData): string | null {
  const raw = String(form.get("rubric") ?? "").trim();
  if (!raw) return null;
  try {
    const dims = sanitizeRubric(JSON.parse(raw));
    return dims.length > 0 ? JSON.stringify(dims) : null;
  } catch {
    return null;
  }
}

// Postgres text columns reject the NUL byte (char code 0); PDF
// extraction often emits it plus other C0 control chars. Drop every
// control char below 32 except tab (9), LF (10) and CR (13).
export function sanitizeText(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 32 || c === 9 || c === 10 || c === 13) {
      out += s[i];
    }
  }
  return out;
}

// Count chars Postgres text can't take, for diagnostics.
export function countBadChars(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 32 && c !== 9 && c !== 10 && c !== 13) n++;
  }
  return n;
}

export type KbResult =
  | { ok: true; kb: string; diag: string }
  | { ok: false; error: string; status: number };

// Resolve the knowledge base from a submitted form, honouring kb_mode
// ("text" pastes a string, "pdf" extracts one from an uploaded file),
// then sanitize it for Postgres. Shared by the create and edit routes.
export async function resolveKnowledgeBase(form: FormData): Promise<KbResult> {
  const kbMode = String(form.get("kb_mode") ?? "text");
  let knowledgeBase = "";

  if (kbMode === "pdf") {
    const pdf = form.get("pdf");
    if (!(pdf instanceof File)) {
      return { ok: false, error: "No PDF file received", status: 400 };
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
      return { ok: false, error: `Could not read PDF: ${message}`, status: 422 };
    }
  } else {
    knowledgeBase = String(form.get("kb_text") ?? "").trim();
  }

  const badBefore = countBadChars(knowledgeBase);
  knowledgeBase = sanitizeText(knowledgeBase);
  const badAfter = countBadChars(knowledgeBase);
  return {
    ok: true,
    kb: knowledgeBase,
    diag: `sanitizer v3 · bad chars ${badBefore}→${badAfter}`,
  };
}
