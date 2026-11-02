// Which kind of audit a single uploaded file turns into, decided from its
// extension (and MIME type as a fallback). Shared by the upload form and the
// upload API routes so both sides agree on what's accepted.

export type UploadKind = "recording" | "transcript" | "spreadsheet";

// Audio and video containers. AssemblyAI accepts all of these; Gemini only a
// subset (see GEMINI_AUDIO_MIME in lib/auditor.ts).
export const RECORDING_EXTENSIONS = [
  "mp3", "mpeg", "mpga", "wav", "m4a", "mp4", "aac", "amr", "ogg", "oga",
  "opus", "flac", "webm", "wma", "aiff", "aif", "3gp", "3gpp", "caf", "gsm",
  "mov", "mkv", "avi", "m4v", "wmv", "flv",
];

export const TRANSCRIPT_EXTENSIONS = ["txt", "text", "md", "srt", "vtt", "log", "pdf", "docx"];

export const SPREADSHEET_EXTENSIONS = ["csv", "tsv", "xlsx", "xls", "xlsm", "xlsb", "ods", "numbers"];

export const UPLOAD_ACCEPT = [
  "audio/*",
  "video/*",
  ...[...RECORDING_EXTENSIONS, ...TRANSCRIPT_EXTENSIONS, ...SPREADSHEET_EXTENSIONS].map((e) => `.${e}`),
].join(",");

export function fileExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
}

export function classifyUpload(name: string, mimeType = ""): UploadKind | null {
  const ext = fileExtension(name);
  if (SPREADSHEET_EXTENSIONS.includes(ext)) return "spreadsheet";
  if (TRANSCRIPT_EXTENSIONS.includes(ext)) return "transcript";
  if (RECORDING_EXTENSIONS.includes(ext)) return "recording";
  if (mimeType.startsWith("audio/") || mimeType.startsWith("video/")) return "recording";
  if (mimeType.startsWith("text/")) return "transcript";
  return null;
}
