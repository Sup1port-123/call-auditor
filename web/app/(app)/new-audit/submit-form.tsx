"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import LottiePlayer from "@/components/lottie-player";
import { AUDIT_PRESETS, STRICTNESS_LEVELS } from "@/lib/rubric";

export default function SubmitForm() {
  const router = useRouter();
  const [audioUrl, setAudioUrl] = useState("");
  const [preset, setPreset] = useState("general");
  const [strictness, setStrictness] = useState("standard");
  const [customFocus, setCustomFocus] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/audits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          audio_url: audioUrl,
          preset,
          strictness,
          custom_focus: customFocus,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Submission failed");
      router.push(`/audits/${data.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  }

  if (submitting) {
    return (
      <div className="rounded-3xl bg-[var(--paper)] p-12 flex flex-col items-center text-center">
        <LottiePlayer
          src="/lottie/interactive-volume.lottie"
          className="w-48 h-48"
        />
        <div className="font-display text-xl font-bold mt-2">
          Sending Otis on it…
        </div>
        <div className="text-zinc-500 text-sm mt-2">
          We&apos;ll send you to the audit page in a second.
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-7">
      <Field
        index="01"
        label="Recording URL"
        hint="A publicly accessible https URL pointing to an audio file (mp3/wav/m4a). Direct file uploads land in a later phase."
      >
        <input
          type="url"
          required
          value={audioUrl}
          onChange={(e) => setAudioUrl(e.target.value)}
          placeholder="https://your-storage.example.com/call.mp3"
          className="w-full rounded-2xl bg-[var(--paper)] border border-transparent focus:border-[var(--sky-500)] focus:bg-white px-5 py-3 text-sm focus:outline-none transition"
        />
      </Field>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Field index="02" label="Preset" hint="What kind of audit is this?">
          <select
            value={preset}
            onChange={(e) => setPreset(e.target.value)}
            className="w-full rounded-2xl bg-[var(--paper)] border border-transparent focus:border-[var(--sky-500)] focus:bg-white px-4 py-3 text-sm focus:outline-none transition"
          >
            {Object.entries(AUDIT_PRESETS).map(([key, p]) => (
              <option key={key} value={key}>
                {p.name}
              </option>
            ))}
          </select>
          <p className="text-xs text-zinc-500 mt-2">
            {AUDIT_PRESETS[preset]?.description}
          </p>
        </Field>

        <Field index="03" label="Strictness" hint="How tough should Otis be?">
          <select
            value={strictness}
            onChange={(e) => setStrictness(e.target.value)}
            className="w-full rounded-2xl bg-[var(--paper)] border border-transparent focus:border-[var(--sky-500)] focus:bg-white px-4 py-3 text-sm focus:outline-none transition"
          >
            {Object.keys(STRICTNESS_LEVELS).map((k) => (
              <option key={k} value={k}>
                {k.charAt(0).toUpperCase() + k.slice(1)}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <Field
        index="04"
        label="Custom focus (optional)"
        hint="Anything specific you want Otis to pay attention to."
      >
        <textarea
          value={customFocus}
          onChange={(e) => setCustomFocus(e.target.value)}
          rows={3}
          placeholder="e.g. did the AI mention the 18% interest cap?"
          className="w-full rounded-2xl bg-[var(--paper)] border border-transparent focus:border-[var(--sky-500)] focus:bg-white px-5 py-3 text-sm focus:outline-none transition"
        />
      </Field>

      {error && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 text-rose-700 text-sm px-5 py-3">
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="w-full rounded-full bg-[var(--ink)] text-white py-3.5 text-sm font-medium hover:bg-zinc-800 transition disabled:opacity-50 shadow-[0_10px_30px_-12px_rgba(15,23,42,0.5)]"
      >
        Run audit
      </button>
    </form>
  );
}

function Field({
  index,
  label,
  hint,
  children,
}: {
  index: string;
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-baseline gap-2 mb-2">
        <span className="font-mono text-xs text-zinc-400">({index})</span>
        <label className="text-sm font-medium text-[var(--ink)]">
          {label}
        </label>
      </div>
      {children}
      {hint && <p className="text-xs text-zinc-500 mt-2">{hint}</p>}
    </div>
  );
}
