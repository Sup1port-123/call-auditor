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
        // network blip — try again next tick
      }
    }, 4000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [id, status, router]);

  const copy = STATUS_COPY[status];

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

      {status === "failed" && error && (
        <div className="mt-6 rounded-2xl border border-rose-200 bg-rose-50 text-rose-700 text-sm px-4 py-3 max-w-xl text-left">
          {error}
        </div>
      )}

      <div className="mt-8 flex items-center gap-3 text-xs text-zinc-500">
        <Step active={status === "transcribing"} done={status !== "transcribing"} label="Transcribe" />
        <span className="text-zinc-300">→</span>
        <Step
          active={status === "scoring"}
          done={status === "completed"}
          label="Score"
        />
      </div>
    </div>
  );
}

function Step({
  active,
  done,
  label,
}: {
  active: boolean;
  done: boolean;
  label: string;
}) {
  return (
    <span className="flex items-center gap-2">
      <span className="relative flex h-2 w-2">
        {active && (
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[var(--sky-500)] opacity-75" />
        )}
        <span
          className={`relative inline-flex rounded-full h-2 w-2 ${
            active
              ? "bg-[var(--sky-500)]"
              : done
              ? "bg-emerald-500"
              : "bg-zinc-300"
          }`}
        />
      </span>
      <span
        className={
          active
            ? "text-[var(--ink)]"
            : done
            ? "text-emerald-600"
            : "text-zinc-400"
        }
      >
        {done && !active ? `✓ ${label}d` : label}
      </span>
    </span>
  );
}
