import { formatKartaTranscript } from "@/lib/karta-transcript";

// One call as sent by the Google Sheets sync script. Every field is optional
// because Karta and Convozen sheets carry different columns.
export type SheetRow = {
  call_id?: string;
  agent_name?: string;
  recording_url?: string;
  transcript?: unknown;
  summary?: string;
  mobile?: string;
  duration_seconds?: number | string | null;
  call_time?: string;
  disconnect_reason?: string;
};

export const MIN_WORDS = 30;
export const MIN_SECONDS = 60;

// Convozen "AI Call Logs" chat history carries session metadata and control
// tokens that are not part of the conversation.
export function cleanChatHistory(raw: string): string {
  return raw
    .replace(/<session_metadata>[\s\S]*?<\/session_metadata>\s*/g, "")
    .replace(/<\|HINDI\|>\s*/g, "")
    .replace(/<\|ENGLISH\|>\s*/g, "")
    .replace(/PATIENCE\s+[\d.]+\s*/g, "")
    .replace(/WAITING\s+[\d.]+\s*/g, "")
    .replace(/ENDCALL\s*/g, "")
    .replace(/TRANSFERCALL\s*/g, "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

export function wordCount(t: string): number {
  return t.trim().split(/\s+/).filter(Boolean).length;
}

// Text to score for a row, or null when the row has none (recording only).
export function transcriptFor(row: SheetRow, source: "karta" | "convozen"): string | null {
  const formatted = formatKartaTranscript(row.transcript);
  const text = formatted ? (source === "convozen" ? cleanChatHistory(formatted) : formatted) : "";
  if (text) return text;
  const summary = (row.summary ?? "").trim();
  return summary || null;
}

export function toSeconds(v: unknown): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? Math.round(v) : null;
  const s = String(v).trim();
  if (/^\d+:\d{1,2}(:\d{1,2})?$/.test(s)) {
    const parts = s.split(":").map(Number);
    return parts.length === 3 ? parts[0] * 3600 + parts[1] * 60 + parts[2] : parts[0] * 60 + parts[1];
  }
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n) : null;
}

// Sheet timestamps like "2026-10-26 00:09:56" carry no zone; the call centre
// works in IST.
export function toIso(v: string | undefined, fallback: string): string {
  if (!v) return fallback;
  const s = v.trim();
  const withZone = /[zZ]|[+-]\d{2}:?\d{2}$/.test(s) ? s : `${s.replace(" ", "T")}+05:30`;
  const d = new Date(withZone);
  return Number.isNaN(d.getTime()) ? fallback : d.toISOString();
}
