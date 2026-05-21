export type Batch = {
  id: string;
  label: string | null;
  agent_id: string | null;
  preset: string | null;
  strictness: string | null;
  custom_focus: string | null;
  url_column: string | null;
  total: number;
  created_at: string;
};

export function newBatchId(): string {
  const d = new Date();
  const stamp = d.toISOString().slice(0, 10).replace(/-/g, "");
  return `bat-${stamp}-${Math.random().toString(16).slice(2, 8)}`;
}

// Header names (normalized: lowercased, alphanumeric only) that signal a
// recording-URL column, best match first.
const URL_COLUMN_PATTERNS = [
  "recordingurl",
  "recordinglink",
  "callrecordingurl",
  "callrecording",
  "audiourl",
  "audiolink",
  "callurl",
  "recording",
  "audio",
  "recordingfile",
  "mp3url",
  "mp3",
  "fileurl",
  "url",
  "link",
];

function normalizeHeader(h: string): string {
  return h.toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Pick the column most likely to hold recording URLs. Returns the exact
// original header string, or null if nothing matches.
export function detectUrlColumn(headers: string[]): string | null {
  const normalized = headers.map((h) => ({ raw: h, norm: normalizeHeader(h) }));
  for (const pattern of URL_COLUMN_PATTERNS) {
    const exact = normalized.find((h) => h.norm === pattern);
    if (exact) return exact.raw;
  }
  for (const pattern of URL_COLUMN_PATTERNS) {
    const partial = normalized.find((h) => h.norm.includes(pattern));
    if (partial) return partial.raw;
  }
  return null;
}
