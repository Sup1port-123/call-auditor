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
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-12 flex flex-col items-center text-center">
        <LottiePlayer
          src="/lottie/interactive-volume.lottie"
          className="w-48 h-48"
        />
        <div className="mt-4 text-lg font-medium">Submitting to Otis…</div>
        <div className="text-zinc-400 text-sm mt-1">
          We&apos;ll send you to the audit page in a sec.
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-6">
      <Field
        label="Recording URL"
        hint="A publicly accessible https URL pointing to an audio file (mp3/wav/m4a). For now we don't support direct uploads — host it somewhere first."
      >
        <input
          type="url"
          required
          value={audioUrl}
          onChange={(e) => setAudioUrl(e.target.value)}
          placeholder="https://your-storage.example.com/call.mp3"
          className="w-full rounded-md bg-zinc-900 border border-zinc-700 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-fuchsia-500"
        />
      </Field>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Field label="Preset" hint="What kind of audit is this?">
          <select
            value={preset}
            onChange={(e) => setPreset(e.target.value)}
            className="w-full rounded-md bg-zinc-900 border border-zinc-700 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-fuchsia-500"
          >
            {Object.entries(AUDIT_PRESETS).map(([key, p]) => (
              <option key={key} value={key}>
                {p.name}
              </option>
            ))}
          </select>
          <p className="text-xs text-zinc-500 mt-1.5">
            {AUDIT_PRESETS[preset]?.description}
          </p>
        </Field>

        <Field label="Strictness" hint="How tough should Otis be?">
          <select
            value={strictness}
            onChange={(e) => setStrictness(e.target.value)}
            className="w-full rounded-md bg-zinc-900 border border-zinc-700 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-fuchsia-500"
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
        label="Custom focus (optional)"
        hint="Anything specific you want Otis to pay attention to."
      >
        <textarea
          value={customFocus}
          onChange={(e) => setCustomFocus(e.target.value)}
          rows={3}
          placeholder="e.g. did the AI mention the 18% interest cap?"
          className="w-full rounded-md bg-zinc-900 border border-zinc-700 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-fuchsia-500"
        />
      </Field>

      {error && (
        <div className="rounded-md border border-rose-500/40 bg-rose-500/10 text-rose-200 text-sm px-4 py-3">
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="w-full rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 py-3 text-sm font-medium hover:opacity-90 transition disabled:opacity-50"
      >
        Run audit
      </button>
    </form>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-sm font-medium mb-1.5">{label}</label>
      {children}
      {hint && <p className="text-xs text-zinc-500 mt-1.5">{hint}</p>}
    </div>
  );
}
