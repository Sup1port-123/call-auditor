"use client";
// web/components/ReviewBadge.tsx
// Drop this badge anywhere you show an audit row or audit detail card.
//
// Usage:
//   import ReviewBadge from "@/components/ReviewBadge";
//   <ReviewBadge auditId={audit.id} reason={audit.review_reason} />
//
// When the user clicks "Mark reviewed" the badge disappears and the DB is updated.

import { useState } from "react";

type Props = {
  auditId: string;
  reason?: string | null;
  /** If you want to hide the badge entirely once marked reviewed, pass onReviewed */
  onReviewed?: () => void;
};

export default function ReviewBadge({ auditId, reason, onReviewed }: Props) {
  const [dismissed, setDismissed] = useState(false);
  const [loading, setLoading] = useState(false);

  if (dismissed) return null;

  async function markReviewed() {
    setLoading(true);
    try {
      await fetch(`/api/audits/${auditId}/review`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reviewed: true }),
      });
      setDismissed(true);
      onReviewed?.();
    } catch {
      // silently fail — badge stays visible
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex items-start gap-2 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm">
      {/* Warning icon */}
      <span className="mt-0.5 text-amber-500 shrink-0">⚠</span>

      <div className="flex-1 min-w-0">
        <p className="font-semibold text-amber-800">Flagged for human review</p>
        {reason && (
          <p className="text-amber-700 mt-0.5 text-xs leading-relaxed">{reason}</p>
        )}
      </div>

      <button
        onClick={markReviewed}
        disabled={loading}
        className="shrink-0 rounded-full bg-amber-100 border border-amber-300 px-3 py-1 text-xs font-medium text-amber-800 hover:bg-amber-200 transition disabled:opacity-50"
      >
        {loading ? "Saving…" : "Mark reviewed"}
      </button>
    </div>
  );
}
