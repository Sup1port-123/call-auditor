import { NextResponse } from "next/server";

// Allow up to 60s for transcription + larger body for audio files
export const maxDuration = 60;

const MIME_MAP: Record<string, string> = {
  mp3: "audio/mpeg",
  mp4: "audio/mp4",
  mpeg: "audio/mpeg",
  mpga: "audio/mpeg",
  m4a: "audio/mp4",
  wav: "audio/wav",
  webm: "audio/webm",
  ogg: "audio/ogg",
};

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    // Prefer Sarvam (better for Hindi/mixed calls), fall back to Deepgram
    const sarvamKey = process.env.SARVAM_API_KEY;
    const deepgramKey = process.env.DEEPGRAM_API_KEY;

    if (sarvamKey) {
      return await transcribeWithSarvam(file, sarvamKey);
    } else if (deepgramKey) {
      return await transcribeWithDeepgram(file, deepgramKey);
    } else {
      return NextResponse.json(
        { error: "No transcription API key configured" },
        { status: 500 }
      );
    }
  } catch (err) {
    console.error("[transcribe]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Transcription failed" },
      { status: 500 }
    );
  }
}

async function transcribeWithSarvam(
  file: File,
  apiKey: string
): Promise<NextResponse> {
  const form = new FormData();
  form.append("file", file, file.name);
  form.append("model", "saarika:v2.5");
  form.append("language_code", "unknown");
  form.append("with_timestamps", "true");

  const res = await fetch("https://api.sarvam.ai/speech-to-text", {
    method: "POST",
    headers: { "api-subscription-key": apiKey },
    body: form,
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Sarvam error (${res.status}): ${body.slice(0, 300)}`);
  }

  const data = (await res.json()) as {
    transcript: string;
    diarized_transcript?: {
      entries: {
        transcript: string;
        start_time_seconds: number;
        end_time_seconds: number;
        speaker_id: string;
      }[];
    };
  };

  let transcript: string;
  if (data.diarized_transcript?.entries?.length) {
    transcript = data.diarized_transcript.entries
      .map((e) => {
        const mm = String(Math.floor(e.start_time_seconds / 60)).padStart(2, "0");
        const ss = String(Math.floor(e.start_time_seconds % 60)).padStart(2, "0");
        return `[${mm}:${ss}] ${e.speaker_id}: ${e.transcript}`;
      })
      .join("\n");
  } else {
    transcript = data.transcript ?? "";
  }

  return NextResponse.json({ transcript, provider: "sarvam" });
}

async function transcribeWithDeepgram(
  file: File,
  apiKey: string
): Promise<NextResponse> {
  const buffer = await file.arrayBuffer();
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "mp3";
  const contentType = file.type || MIME_MAP[ext] || "audio/mpeg";

  const res = await fetch(
    "https://api.deepgram.com/v1/listen?model=nova-2&language=hi&diarize=true&punctuate=true&utterances=true",
    {
      method: "POST",
      headers: {
        Authorization: `Token ${apiKey}`,
        "Content-Type": contentType,
      },
      body: buffer,
    }
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Deepgram error (${res.status}): ${body.slice(0, 300)}`);
  }

  const data = (await res.json()) as {
    results?: {
      utterances?: { start: number; speaker: number; transcript: string }[];
      channels?: { alternatives?: { transcript?: string }[] }[];
    };
  };

  let transcript: string;
  const utterances = data.results?.utterances;
  if (utterances?.length) {
    transcript = utterances
      .map((u) => {
        const mm = String(Math.floor(u.start / 60)).padStart(2, "0");
        const ss = String(Math.floor(u.start % 60)).padStart(2, "0");
        return `[${mm}:${ss}] Speaker ${u.speaker}: ${u.transcript}`;
      })
      .join("\n");
  } else {
    transcript = data.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? "";
  }

  return NextResponse.json({ transcript, provider: "deepgram" });
}
