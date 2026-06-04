"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ReviewStatus } from "@/lib/types/audit";

const OPTIONS: {
  value: ReviewStatus;
  label: string;
  active: string;
}[] = [
  {
    value: "reviewed",
    label: "Reviewed",
    active: "bg-emerald-100 text-emerald-700 border-emerald-300",
  },
  {
    value: "flagged",
    label: "Flagged",
    active: "bg-amber-100 text-amber-700 border-amber-300",
  },
  {
    value: "not_reviewed",
    label: "Not reviewed",
    active: "bg-zinc-200 text-zinc-700 border-zinc-300",
  },
];

// Segmented control to set an audit's manual review state. Optimistic; reverts
// on failure. stopPropagation so it can live inside clickable rows.
export default function ReviewStatusControl({
  id,
  status,
  refresh = false,
}: {
  id: string;
  status: ReviewStatus | null | undefined;
  // Re-fetch the server component after a change (so filtered lists update).
  refresh?: boolean;
}) {
  const [current, setCurrent] = useState<ReviewStatus>(status ?? "not_reviewed");
  const [saving, setSaving] = useState(false);
  const [, startTransition] = useTransition();
  const router = useRouter();

  async function set(value: ReviewStatus, e: React.MouseEvent) {
    e.stopPropagation();
    e.preventDefault();
    if (value === current || saving) return;
    const prev = current;
    setCurrent(value);
    setSaving(true);
    try {
      const res = await fetch(`/api/audits/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ review_status: value }),
      });
      if (!res.ok) throw new Error("save failed");
      if (refresh) startTransition(() => router.refresh());
    } catch {
      setCurrent(prev);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="inline-flex gap-1"
      onClick={(e) => e.stopPropagation()}
    >
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          disabled={saving}
          onClick={(e) => set(o.value, e)}
          className={`rounded-full border px-2.5 py-1 text-[11px] font-medium whitespace-nowrap transition disabled:opacity-60 ${
            current === o.value
              ? o.active
              : "bg-white text-zinc-400 border-zinc-200 hover:border-zinc-300 hover:text-zinc-600"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// Tiny read-only badge for compact spots (e.g. a dashboard row).
export function ReviewBadge({
  status,
}: {
  status: ReviewStatus | null | undefined;
}) {
  const s = status ?? "not_reviewed";
  if (s === "reviewed") {
    return (
      <span className="rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 text-[10px] font-medium">
        Reviewed
      </span>
    );
  }
  if (s === "flagged") {
    return (
      <span className="rounded-full bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 text-[10px] font-medium">
        Flagged
      </span>
    );
  }
  return (
    <span className="rounded-full bg-zinc-100 text-zinc-500 border border-zinc-200 px-2 py-0.5 text-[10px] font-medium">
      Not reviewed
    </span>
  );
}
