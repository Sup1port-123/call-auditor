// Karta sends the full call transcript as `transcript_text`: a JSON array of
// turns like {"role":"assistant","text":"…","time":"00:14"} (sometimes already
// parsed, sometimes as a JSON string). Turning it into Otis's
// "[MM:SS] Speaker: text" format lets the call be scored without paying for
// transcription.

type KartaTurn = { role?: unknown; text?: unknown; time?: unknown };

const SPEAKER: Record<string, string> = {
  assistant: "Agent",
  agent: "Agent",
  bot: "Agent",
  user: "Customer",
  customer: "Customer",
};

export function formatKartaTranscript(raw: unknown): string | null {
  let turns: unknown = raw;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    if (!trimmed.startsWith("[")) return trimmed;
    try {
      turns = JSON.parse(trimmed);
    } catch {
      return trimmed;
    }
  }
  if (!Array.isArray(turns)) return null;

  const lines = (turns as KartaTurn[])
    .filter((t) => t && typeof t.text === "string" && t.text.trim())
    .map((t) => {
      const role = String(t.role ?? "").toLowerCase();
      const speaker = SPEAKER[role] ?? (role || "Speaker");
      const time = typeof t.time === "string" && t.time ? `[${t.time}] ` : "";
      return `${time}${speaker}: ${String(t.text).trim()}`;
    });
  return lines.length > 0 ? lines.join("\n") : null;
}
