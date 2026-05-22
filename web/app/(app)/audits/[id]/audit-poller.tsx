"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import LottiePlayer from "@/components/lottie-player";

type Status = "transcribing" | "scoring" | "completed" | "failed";

const STATUS_COPY: Record<Status, { title: string; sub: string }> = {
  transcribing: {
    title: "Listening to the call…",
    sub: "Otis is transcribing with speaker diarization.",
  },
  scoring: {
    title: "Scoring against the rubric…",
    sub: "Transcript done. The LLM is now grading every dimension.",
  },
  completed: { title: "Done!", sub: "Loading results…" },
  failed: { title: "Something went wrong.", sub: "" },
};

// Transcription / scoring report no real percentage, so the bar is a
// time estimate: it eases toward the end of each phase and snaps to the
// real value the moment a phase actually completes. Transcribe owns the
// first 65% of the bar, scoring the last 35%.
const TRANSCRIBE_MS = 40_000;
const SCORE_MS = 30_000;

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
  const [progress, setProgress] = useState(
    initialStatus === "scoring" ? 65 : 4,
  );

  const phaseStartRef = useRef(Date.now());
  const progressRef = useRef(progress);

  // Poll the status endpoint (which also self-heals stuck audits).
  useEffect(() => {
    if (status === "completed" || status === "failed") return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/audits/${id}/status`, {
          cache: "no-store",
        });
        if (!res.ok) return;
        const data = (await res.json()) as {
          status: Status;
          error_message: string | null;
        };
        setStatus((prev) => {
          if (data.status !== prev) phaseStartRef.current = Date.now();
          return data.status;
        });
        setError(data.error_message);
        if (data.status === "completed") router.refresh();
      } catch {
        // network blip — try next tick
      }
    }, 4000);
    return () => clearInterval(interval);
  }, [id, status, router]);

  // Drive the estimate bar. Never moves backward.
  useEffect(() => {
    if (status === "completed") {
      progressRef.current = 100;
      setProgress(100);
      return;
    }
    if (status === "failed") return;

    if (status === "scoring" && progressRef.current < 65) {
      progressRef.current = 65;
      setProgress(65);
    }

    const tick = setInterval(() => {
      const elapsed = Date.now() - phaseStartRef.current;
      const target =
        status === "transcribing"
          ? Math.min(62, 4 + (elapsed / TRANSCRIBE_MS) * 58)
          : Math.min(97, 65 + (elapsed / SCORE_MS) * 32);
      if (target > progressRef.current) {
        progressRef.current = target;
        setProgress(target);
      }
    }, 250);
    return () => clearInterval(tick);
  }, [status]);

  const copy = STATUS_COPY[status];
  const failed = status === "failed";

  return (
    <div className="rounded-3xl bg-[var(--paper)] p-12 flex flex-col items-center text-center">
      <LottiePlayer
        src="/lottie/interactive-volume.lottie"
        className="w-56 h-56"
      />
      <div className="font-display text-2xl font-bold text-[var(--ink)] mt-2">
        {copy.title}
      </div>
      <div className="text-zinc-500 text-sm mt-2 max-w-md">{copy.sub}</div>

      {!failed && (
        <div className="w-full max-w-md mt-8">
          <div className="flex items-center justify-between text-xs mb-2">
            <span className="font-medium text-[var(--ink)]">
              {status === "transcribing"
                ? "Transcribing"
                : status === "scoring"
                ? "Scoring"
                : "Finishing"}
            </span>
            <span className="tabular-nums text-zinc-500">
              {Math.round(progress)}%
            </span>
          </div>
          <div className="h-3 rounded-full bg-white overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-[var(--sky-500)] via-[var(--violet-500)] to-[var(--pink-500)] transition-[width] duration-500 ease-out"
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="flex items-center justify-between text-[11px] text-zinc-400 mt-2">
            <span
              className={
                status !== "transcribing" ? "text-emerald-600" : undefined
              }
            >
              {status !== "transcribing" ? "✓ Transcribed" : "Transcribe"}
            </span>
            <span
              className={
                status === "completed" ? "text-emerald-600" : undefined
              }
            >
              {status === "completed" ? "✓ Scored" : "Score"}
            </span>
          </div>
        </div>
      )}

      {failed && error && (
        <div className="mt-6 rounded-2xl border border-rose-200 bg-rose-50 text-rose-700 text-sm px-4 py-3 max-w-xl text-left">
          {error}
        </div>
      )}
    </div>
  );
}
