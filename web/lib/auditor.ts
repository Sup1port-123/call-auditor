import { AssemblyAI } from "assemblyai";
import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenAI, Type } from "@google/genai";
import {
  buildSystemPrompt,
  RUBRIC_DIMENSIONS,
  type RubricDimension,
} from "./rubric";

export type DimScore = {
  score: number | null;
  rationale: string;
  name?: string;
  min?: number;
  max?: number;
};

export type EvaluationResult = {
  scores: Record<string, DimScore>;
  overall_score: number;
  summary: string;
  strengths: string;
  what_was_lacking: string;
  improvement_recommendations: string[];
};

export type AuditScored = EvaluationResult & {
  llm_provider: string;
  llm_fallback_reason: string | null;
};

const ASSEMBLY_LANGUAGE = process.env.ASSEMBLYAI_LANGUAGE || "hi";

export function getAssemblyClient() {
  const key = process.env.ASSEMBLYAI_API_KEY;
  if (!key) throw new Error("ASSEMBLYAI_API_KEY is not set");
  return new AssemblyAI({ apiKey: key });
}

// ---------------------------------------------------------------------------
// Whisper transcription (OpenAI) — synchronous alternative to AssemblyAI.
// Used automatically when ASSEMBLYAI_API_KEY is not set.
// Note: Whisper does not support speaker diarization.
// ---------------------------------------------------------------------------
async function submitTranscriptionWithWhisper(audioUrl: string): Promise<{
  transcriptId: string;
  transcript: string;
  durationSeconds: number | null;
}> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "No ASSEMBLYAI_API_KEY and no OPENAI_API_KEY — cannot transcribe. Set at least one.",
    );
  }

  const audioRes = await fetch(audioUrl);
  if (!audioRes.ok) {
    throw new Error(
      `Could not download audio (${audioRes.status}): ${audioUrl.slice(0, 120)}`,
    );
  }
  const audioBuffer = await audioRes.arrayBuffer();

  const urlPath = audioUrl.split("?")[0];
  const ext = urlPath.split(".").pop()?.toLowerCase() ?? "mp3";
  const MIME_MAP: Record<string, string> = {
    mp3: "audio/mpeg",
    mp4: "audio/mp4",
    mpeg: "audio/mpeg",
    mpga: "audio/mpeg",
    m4a: "audio/m4a",
    wav: "audio/wav",
    webm: "audio/webm",
  };
  const mimeType = MIME_MAP[ext] ?? "audio/mpeg";

  const form = new FormData();
  form.append(
    "file",
    new Blob([audioBuffer], { type: mimeType }),
    `audio.${ext}`,
  );
  form.append("model", "whisper-1");
  form.append("response_format", "verbose_json");
  form.append("timestamp_granularities[]", "segment");

  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Whisper API error (${res.status}): ${body.slice(0, 300)}`);
  }

  const data = (await res.json()) as {
    text: string;
    duration?: number;
    segments?: { start: number; text: string }[];
  };

  const transcript =
    data.segments && data.segments.length > 0
      ? data.segments
          .map((seg) => {
            const mm = String(Math.floor(seg.start / 60)).padStart(2, "0");
            const ss = String(Math.floor(seg.start % 60)).padStart(2, "0");
            return `[${mm}:${ss}] ${seg.text.trim()}`;
          })
          .join("\n")
      : data.text;

  const durationSeconds =
    typeof data.duration === "number" ? Math.round(data.duration) : null;

  const transcriptId = `whisper_${Date.now()}_${Math.random()
    .toString(16)
    .slice(2, 8)}`;

  return { transcriptId, transcript, durationSeconds };
}

// ---------------------------------------------------------------------------
// Submit a recording for transcription.
// Auto-selects AssemblyAI when ASSEMBLYAI_API_KEY is set, else uses Whisper.
// ---------------------------------------------------------------------------
export async function submitTranscription(opts: {
  audioUrl: string;
  webhookUrl: string;
  auditId: string;
}): Promise<{
  transcriptId: string;
  transcript?: string;
  durationSeconds?: number | null;
}> {
  const assemblyKey = process.env.ASSEMBLYAI_API_KEY;

  if (!assemblyKey) {
    return submitTranscriptionWithWhisper(opts.audioUrl);
  }

  const res = await fetch("https://api.assemblyai.com/v2/transcript", {
    method: "POST",
    headers: { authorization: assemblyKey, "content-type": "application/json" },
    body: JSON.stringify({
      audio_url: opts.audioUrl,
      speech_models: ["universal-3-pro", "universal-2"],
      speaker_labels: true,
      language_code: ASSEMBLY_LANGUAGE,
      webhook_url: opts.webhookUrl,
      webhook_auth_header_name: "x-audit-id",
      webhook_auth_header_value: opts.auditId,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `AssemblyAI submit failed (${res.status}): ${body.slice(0, 300)}`,
    );
  }

  const data = (await res.json()) as { id?: string };
  if (!data.id) throw new Error("AssemblyAI did not return a transcript id");
  return { transcriptId: data.id };
}

export async function fetchFormattedTranscript(transcriptId: string): Promise<{
  text: string;
  raw: string;
}> {
  const client = getAssemblyClient();
  const t = await client.transcripts.get(transcriptId);
  if (t.status !== "completed") {
    throw new Error(`Transcript not ready (status=${t.status})`);
  }
  const utterances = t.utterances ?? [];
  if (utterances.length === 0) {
    return { text: t.text ?? "", raw: t.text ?? "" };
  }
  const lines = utterances.map((u) => {
    const seconds = Math.floor((u.start ?? 0) / 1000);
    const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
    const ss = String(seconds % 60).padStart(2, "0");
    return `[${mm}:${ss}] Speaker ${u.speaker}: ${u.text}`;
  });
  const formatted = lines.join("\n");
  return { text: formatted, raw: t.text ?? "" };
}

// ---------------------------------------------------------------------------
// LLM Scoring
// ---------------------------------------------------------------------------

function enrichScores(
  raw: Record<string, { score?: number | null; rationale?: string }> | undefined,
  rubric: RubricDimension[],
): Record<string, DimScore> {
  const out: Record<string, DimScore> = {};
  for (const d of rubric) {
    const r = raw?.[d.key];
    let s = r?.score ?? null;
    if (typeof s === "number" && Number.isFinite(s)) {
      s = Math.max(d.min, Math.min(d.max, Math.round(s)));
    } else {
      s = null;
    }
    out[d.key] = {
      score: s,
      rationale: r?.rationale ?? "",
      name: d.name,
      min: d.min,
      max: d.max,
    };
  }
  return out;
}

export async function scoreTranscript(opts: {
  transcript: string;
  preset?: string;
  strictness?: string;
  customFocus?: string;
  agentName?: string;
  knowledgeBase?: string;
  rubric?: RubricDimension[];
}): Promise<AuditScored> {
  const rubric =
    opts.rubric && opts.rubric.length > 0 ? opts.rubric : RUBRIC_DIMENSIONS;

  const systemPrompt = buildSystemPrompt({
    preset: opts.preset,
    strictness: opts.strictness,
    customFocus: opts.customFocus,
    agentName: opts.agentName,
    knowledgeBase: opts.knowledgeBase,
    rubric,
  });

  const ALL_PROVIDERS = ["openai", "gemini", "anthropic"];
  const explicit = (process.env.LLM_PROVIDER || "openai").toLowerCase();
  const order = [explicit, ...ALL_PROVIDERS.filter((p) => p !== explicit)];

  let fallbackReason: string | null = null;
  for (const provider of order) {
    try {
      let result: EvaluationResult | null = null;
      if (provider === "openai" && process.env.OPENAI_API_KEY) {
        result = await scoreWithOpenAI(systemPrompt, opts.transcript);
      } else if (provider === "gemini" && process.env.GOOGLE_API_KEY) {
        result = await scoreWithGemini(systemPrompt, opts.transcript, rubric);
      } else if (provider === "anthropic" && process.env.ANTHROPIC_API_KEY) {
        result = await scoreWithClaude(systemPrompt, opts.transcript);
      }
      if (result) {
        return {
          ...result,
          scores: enrichScores(result.scores, rubric),
          llm_provider: provider,
          llm_fallback_reason: fallbackReason,
        };
      }
    } catch (err) {
      fallbackReason = `${provider} failed: ${
        err instanceof Error ? err.message : String(err)
      }`;
      console.error("[otis]", fallbackReason);
    }
  }

  throw new Error(
    `Every configured LLM failed${fallbackReason ? ` (${fallbackReason})` : ""}. ` +
      "Set OPENAI_API_KEY, GOOGLE_API_KEY, or ANTHROPIC_API_KEY in the env.",
  );
}

async function scoreWithOpenAI(
  systemPrompt: string,
  transcript: string,
): Promise<EvaluationResult> {
  const apiKey = process.env.OPENAI_API_KEY!;
  const model = process.env.OPENAI_MODEL || "gpt-4o";

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `TRANSCRIPT:\n${transcript}` },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenAI ${res.status}: ${body.slice(0, 300)}`);
  }

  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error("OpenAI returned an empty response");
  return parseJsonResponse(text);
}

async function scoreWithGemini(
  systemPrompt: string,
  transcript: string,
  rubric: RubricDimension[],
): Promise<EvaluationResult> {
  const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY! });
  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";

  const scoreBlock = {
    type: Type.OBJECT,
    properties: {
      score: { type: Type.INTEGER, nullable: true },
      rationale: { type: Type.STRING },
    },
    required: ["score", "rationale"],
  };

  const scoresSchema = {
    type: Type.OBJECT,
    properties: Object.fromEntries(rubric.map((d) => [d.key, scoreBlock])),
    required: rubric.map((d) => d.key),
  };

  const response = await ai.models.generateContent({
    model,
    contents: [{ role: "user", parts: [{ text: `TRANSCRIPT:\n${transcript}` }] }],
    config: {
      systemInstruction: systemPrompt,
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          scores: scoresSchema,
          overall_score: { type: Type.INTEGER },
          summary: { type: Type.STRING },
          strengths: { type: Type.STRING },
          what_was_lacking: { type: Type.STRING },
          improvement_recommendations: { type: Type.ARRAY, items: { type: Type.STRING } },
        },
        required: ["scores","overall_score","summary","strengths","what_was_lacking","improvement_recommendations"],
      },
      temperature: 0.2,
    },
  });

  const text = response.text;
  if (!text) throw new Error("Gemini returned an empty response");
  return JSON.parse(text) as EvaluationResult;
}

async function scoreWithClaude(
  systemPrompt: string,
  transcript: string,
): Promise<EvaluationResult> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  const model = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5";
  const message = await client.messages.create({
    model,
    max_tokens: 4096,
    temperature: 0.2,
    system: systemPrompt,
    messages: [{ role: "user", content: `TRANSCRIPT:\n${transcript}` }],
  });
  const content = message.content.find((c) => c.type === "text");
  if (!content || content.type !== "text") {
    throw new Error("Claude returned no text content");
  }
  return parseJsonResponse(content.text);
}

function parseJsonResponse(text: string): EvaluationResult {
  const cleaned = text.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
  return JSON.parse(cleaned) as EvaluationResult;
  }
