"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import LottiePlayer from "@/components/lottie-player";

type Status = "transcribing" | "scoring" | "completed" | "failed";

const STATUS_COPY: Record<Status, { title: string; sub: string }> = {
  transcribing: {
    title: "Listening to the call…",
    sub: "Otis is transcribing with speaker diarization. This usually takes 30–90 seconds.",
  },
  scoring: {
    title: "Scoring against the rubric…",
    sub: "Transcript done. The LLM is now grading every dimension.",
  },
  completed: { title: "Done!", sub: "Loading results…" },
  failed: { title: "Something went wrong.", sub: "" },
};

export default function AuditPoller({
  id,
  initialStatus,
  initialError,
}: {
  id: string;
  initialStatus: Status;
  initialError: string | null;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>(initialStatus);
  const [error, setError] = useState<string | null>(initialError);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (status === "completed" || status === "failed") return;

    intervalRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/audits/${id}/status`, {
          cache: "no-store",
        });
        if (!res.ok) return;
        const data = (await res.json()) as {
          status: Status;
          error_message: string | null;
        };
        setStatus(data.status);
        setError(data.error_message);
        if (data.status === "completed") {
          if (intervalRef.current) clearInterval(intervalRef.current);
          router.refresh();
        }
      } catch {
        // network blip — poll again
      }
    }, 4000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [id, status, router]);

  const copy = STATUS_COPY[status];

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-12 flex flex-col items-center text-center">
      <LottiePlayer
        src="/lottie/interactive-volume.lottie"
        className="w-56 h-56"
      />
      <div className="mt-4 text-xl font-medium">{copy.title}</div>
      <div className="text-zinc-400 text-sm mt-1 max-w-md">{copy.sub}</div>

      {status === "failed" && error && (
        <div className="mt-6 rounded-md border border-rose-500/40 bg-rose-500/10 text-rose-200 text-sm px-4 py-3 max-w-xl text-left">
          {error}
        </div>
      )}

      <div className="mt-8 flex items-center gap-2 text-xs text-zinc-500">
        <Pulse active={status === "transcribing"} />
        <span
          className={
            status === "transcribing"
              ? "text-zinc-200"
              : status === "scoring" || status === "completed"
              ? "text-emerald-400"
              : ""
          }
        >
          {status === "transcribing"
            ? "Transcribing"
            : status === "scoring" || status === "completed"
            ? "✓ Transcribed"
            : "Transcribe"}
        </span>
        <span className="text-zinc-700">→</span>
        <Pulse active={status === "scoring"} />
        <span
          className={
            status === "scoring"
              ? "text-zinc-200"
              : status === "completed"
              ? "text-emerald-400"
              : ""
          }
        >
          {status === "scoring"
            ? "Scoring"
            : status === "completed"
            ? "✓ Scored"
            : "Score"}
        </span>
      </div>
    </div>
  );
}

function Pulse({ active }: { active: boolean }) {
  return (
    <span className="relative flex h-2 w-2">
      {active && (
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-fuchsia-400 opacity-75" />
      )}
      <span
        className={`relative inline-flex rounded-full h-2 w-2 ${
          active ? "bg-fuchsia-500" : "bg-zinc-600"
        }`}
      />
    </span>
  );
}
