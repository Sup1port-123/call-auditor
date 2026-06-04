"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { RawParams } from "@/lib/audit-filters";

type State = {
  days: string;
  from: string;
  to: string;
  callIds: string;
  durOp: string;
  durMin: string;
  durMax: string;
  durUnit: string;
  scoreOp: string;
  scoreMin: string;
  scoreMax: string;
  review: string[];
};

function initState(p: RawParams): State {
  return {
    days: p.days ?? "",
    from: p.from ?? "",
    to: p.to ?? "",
    callIds: p.callIds ?? "",
    durOp: p.durOp ?? "gt",
    durMin: p.durMin ?? "",
    durMax: p.durMax ?? "",
    durUnit: p.durUnit === "min" ? "min" : "sec",
    scoreOp: p.scoreOp ?? "between",
    scoreMin: p.scoreMin ?? "",
    scoreMax: p.scoreMax ?? "",
    review: p.review ? p.review.split(",").filter(Boolean) : [],
  };
}

const REVIEW_OPTIONS = [
  { value: "reviewed", label: "Reviewed" },
  { value: "not_reviewed", label: "Not reviewed" },
  { value: "flagged", label: "Flagged" },
];

function buildQuery(s: State): string {
  const p = new URLSearchParams();
  if (s.days.trim()) p.set("days", s.days.trim());
  if (s.from) p.set("from", s.from);
  if (s.to) p.set("to", s.to);
  if (s.callIds.trim()) p.set("callIds", s.callIds.trim());
  if (s.durOp && (s.durMin.trim() || s.durMax.trim())) {
    p.set("durOp", s.durOp);
    if (s.durMin.trim()) p.set("durMin", s.durMin.trim());
    if (s.durOp === "between" && s.durMax.trim()) p.set("durMax", s.durMax.trim());
    p.set("durUnit", s.durUnit);
  }
  if (s.scoreOp && (s.scoreMin.trim() || s.scoreMax.trim())) {
    p.set("scoreOp", s.scoreOp);
    if (s.scoreMin.trim()) p.set("scoreMin", s.scoreMin.trim());
    if (s.scoreOp === "between" && s.scoreMax.trim())
      p.set("scoreMax", s.scoreMax.trim());
  }
  if (s.review.length) p.set("review", s.review.join(","));
  return p.toString();
}

const OPS = [
  { value: "gt", label: "Greater than" },
  { value: "lt", label: "Less than" },
  { value: "eq", label: "Equal to" },
  { value: "between", label: "Between" },
];

export default function DashboardFilters({
  initial,
}: {
  initial: RawParams;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState<string | null>(null);
  const [s, setS] = useState<State>(() => initState(initial));

  const set = (patch: Partial<State>) => setS((prev) => ({ ...prev, ...patch }));

  function apply() {
    const qs = buildQuery(s);
    setOpen(null);
    startTransition(() => {
      router.push(qs ? `/dashboard?${qs}` : "/dashboard");
    });
  }

  function clearAll() {
    setS(initState({}));
    setOpen(null);
    startTransition(() => router.push("/dashboard"));
  }

  // Active-state summaries for each chip.
  const dateActive = !!(s.days.trim() || s.from || s.to);
  const callActive = !!s.callIds.trim();
  const durActive = !!(s.durOp && (s.durMin.trim() || s.durMax.trim()));
  const scoreActive = !!(s.scoreOp && (s.scoreMin.trim() || s.scoreMax.trim()));
  const reviewActive = s.review.length > 0;
  const anyActive =
    dateActive || callActive || durActive || scoreActive || reviewActive;

  const dateSummary = dateActive
    ? [
        s.days.trim() ? `last ${s.days.trim()}d` : "",
        s.from ? `from ${s.from}` : "",
        s.to ? `to ${s.to}` : "",
      ]
        .filter(Boolean)
        .join(" · ")
    : "Date";

  const durSummary = durActive
    ? `Duration ${opSummary(s.durOp, s.durMin, s.durMax)} ${s.durUnit}`
    : "Duration";

  const scoreSummary = scoreActive
    ? `Score ${opSummary(s.scoreOp, s.scoreMin, s.scoreMax)}`
    : "Audit score";

  const callCount = s.callIds
    .split(/[\n,]/)
    .map((x) => x.trim())
    .filter(Boolean).length;
  const callSummary = callActive
    ? `Call ID (${callCount})`
    : "Call ID";

  const reviewSummary = reviewActive
    ? `Review (${s.review.length})`
    : "Review";

  const toggleReview = (value: string) =>
    set({
      review: s.review.includes(value)
        ? s.review.filter((v) => v !== value)
        : [...s.review, value],
    });

  return (
    <div className="relative mb-10">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] uppercase tracking-[0.25em] text-zinc-400 font-medium mr-1">
          Filter
        </span>

        <Chip
          label={dateSummary}
          active={dateActive}
          isOpen={open === "date"}
          onClick={() => setOpen(open === "date" ? null : "date")}
        />
        <Chip
          label={callSummary}
          active={callActive}
          isOpen={open === "call"}
          onClick={() => setOpen(open === "call" ? null : "call")}
        />
        <Chip
          label={durSummary}
          active={durActive}
          isOpen={open === "dur"}
          onClick={() => setOpen(open === "dur" ? null : "dur")}
        />
        <Chip
          label={scoreSummary}
          active={scoreActive}
          isOpen={open === "score"}
          onClick={() => setOpen(open === "score" ? null : "score")}
        />
        <Chip
          label={reviewSummary}
          active={reviewActive}
          isOpen={open === "review"}
          onClick={() => setOpen(open === "review" ? null : "review")}
        />

        {anyActive && (
          <button
            onClick={clearAll}
            className="ml-1 text-xs text-zinc-500 hover:text-rose-600 transition px-2 py-1"
          >
            Clear all
          </button>
        )}
        {pending && (
          <span className="text-xs text-zinc-400 animate-pulse">updating…</span>
        )}
      </div>

      {open && (
        <>
          {/* click-away backdrop */}
          <button
            aria-label="Close filter"
            className="fixed inset-0 z-10 cursor-default"
            onClick={() => setOpen(null)}
          />
          <div className="absolute z-20 mt-2 w-[min(92vw,420px)] rounded-2xl bg-white border border-zinc-200 shadow-[0_20px_60px_-20px_rgba(15,23,42,0.35)] p-5">
            {open === "date" && (
              <Panel title="Date range" onApply={apply}>
                <div className="text-xs text-zinc-500 mb-2">Quick pick</div>
                <div className="flex flex-wrap gap-2 mb-4">
                  {["7", "10", "30", "90"].map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => set({ days: s.days === d ? "" : d })}
                      className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                        s.days === d
                          ? "bg-[var(--ink)] text-white"
                          : "bg-[var(--paper)] text-zinc-600 hover:bg-[var(--paper-strong)]"
                      }`}
                    >
                      Last {d} days
                    </button>
                  ))}
                </div>
                <Labeled label="Or last N days">
                  <input
                    type="number"
                    min={1}
                    inputMode="numeric"
                    value={s.days}
                    onChange={(e) => set({ days: e.target.value })}
                    placeholder="e.g. 14"
                    className={inputCls}
                  />
                </Labeled>
                <div className="grid grid-cols-2 gap-3 mt-3">
                  <Labeled label="From">
                    <input
                      type="date"
                      value={s.from}
                      onChange={(e) => set({ from: e.target.value })}
                      className={inputCls}
                    />
                  </Labeled>
                  <Labeled label="To">
                    <input
                      type="date"
                      value={s.to}
                      onChange={(e) => set({ to: e.target.value })}
                      className={inputCls}
                    />
                  </Labeled>
                </div>
                <ResetRow onReset={() => set({ days: "", from: "", to: "" })} />
              </Panel>
            )}

            {open === "call" && (
              <Panel title="Call ID / URL" onApply={apply}>
                <p className="text-xs text-zinc-500 mb-2">
                  Matches the recording URL. Enter one or many — one per line or
                  comma-separated.
                </p>
                <textarea
                  rows={5}
                  value={s.callIds}
                  onChange={(e) => set({ callIds: e.target.value })}
                  placeholder={"call-abc123\ncall-def456"}
                  className={`${inputCls} font-mono`}
                />
                <ResetRow onReset={() => set({ callIds: "" })} />
              </Panel>
            )}

            {open === "dur" && (
              <Panel title="Call duration" onApply={apply}>
                <div className="flex items-center gap-2 mb-3">
                  <select
                    value={s.durOp}
                    onChange={(e) => set({ durOp: e.target.value })}
                    className={selectCls}
                  >
                    {OPS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                  <select
                    value={s.durUnit}
                    onChange={(e) => set({ durUnit: e.target.value })}
                    className={selectCls}
                  >
                    <option value="sec">seconds</option>
                    <option value="min">minutes</option>
                  </select>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={0}
                    value={s.durMin}
                    onChange={(e) => set({ durMin: e.target.value })}
                    placeholder={s.durOp === "between" ? "min" : "value"}
                    className={inputCls}
                  />
                  {s.durOp === "between" && (
                    <>
                      <span className="text-zinc-400 text-sm">and</span>
                      <input
                        type="number"
                        min={0}
                        value={s.durMax}
                        onChange={(e) => set({ durMax: e.target.value })}
                        placeholder="max"
                        className={inputCls}
                      />
                    </>
                  )}
                </div>
                <ResetRow
                  onReset={() => set({ durMin: "", durMax: "" })}
                />
              </Panel>
            )}

            {open === "score" && (
              <Panel title="Audit score (0–10)" onApply={apply}>
                <div className="mb-3">
                  <select
                    value={s.scoreOp}
                    onChange={(e) => set({ scoreOp: e.target.value })}
                    className={selectCls}
                  >
                    {OPS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={0}
                    max={10}
                    step={0.1}
                    value={s.scoreMin}
                    onChange={(e) => set({ scoreMin: e.target.value })}
                    placeholder={s.scoreOp === "between" ? "min" : "value"}
                    className={inputCls}
                  />
                  {s.scoreOp === "between" && (
                    <>
                      <span className="text-zinc-400 text-sm">and</span>
                      <input
                        type="number"
                        min={0}
                        max={10}
                        step={0.1}
                        value={s.scoreMax}
                        onChange={(e) => set({ scoreMax: e.target.value })}
                        placeholder="max"
                        className={inputCls}
                      />
                    </>
                  )}
                </div>
                <ResetRow
                  onReset={() => set({ scoreMin: "", scoreMax: "" })}
                />
              </Panel>
            )}

            {open === "review" && (
              <Panel title="Review status" onApply={apply}>
                <p className="text-xs text-zinc-500 mb-3">
                  Show audits in any of the selected states.
                </p>
                <div className="space-y-2">
                  {REVIEW_OPTIONS.map((o) => (
                    <label
                      key={o.value}
                      className="flex items-center gap-3 rounded-xl bg-[var(--paper)] px-4 py-2.5 cursor-pointer hover:bg-[var(--paper-strong)] transition"
                    >
                      <input
                        type="checkbox"
                        checked={s.review.includes(o.value)}
                        onChange={() => toggleReview(o.value)}
                        className="h-4 w-4 accent-[var(--ink)]"
                      />
                      <span className="text-sm">{o.label}</span>
                    </label>
                  ))}
                </div>
                <ResetRow onReset={() => set({ review: [] })} />
              </Panel>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function opSummary(op: string, min: string, max: string): string {
  const a = min.trim();
  const b = max.trim();
  switch (op) {
    case "gt":
      return `> ${a}`;
    case "lt":
      return `< ${a}`;
    case "eq":
      return `= ${a}`;
    case "between":
      return `${a}–${b}`;
    default:
      return a;
  }
}

const inputCls =
  "w-full rounded-xl bg-[var(--paper)] border border-transparent focus:border-[var(--sky-500)] focus:bg-white px-4 py-2.5 text-sm focus:outline-none transition";
const selectCls =
  "rounded-xl bg-[var(--paper)] border border-transparent focus:border-[var(--sky-500)] px-3 py-2.5 text-sm focus:outline-none transition";

function Chip({
  label,
  active,
  isOpen,
  onClick,
}: {
  label: string;
  active: boolean;
  isOpen: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative z-20 rounded-full px-4 py-2 text-xs font-medium transition border ${
        active
          ? "bg-[var(--ink)] text-white border-[var(--ink)]"
          : isOpen
          ? "bg-white border-[var(--sky-500)] text-[var(--ink)]"
          : "bg-[var(--paper)] border-transparent text-zinc-600 hover:bg-[var(--paper-strong)]"
      }`}
    >
      {label}
      <span className="ml-1.5 opacity-60">▾</span>
    </button>
  );
}

function Panel({
  title,
  onApply,
  children,
}: {
  title: string;
  onApply: () => void;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="font-display text-sm font-bold mb-3">{title}</div>
      {children}
      <button
        type="button"
        onClick={onApply}
        className="mt-4 w-full rounded-full bg-[var(--ink)] text-white py-2.5 text-sm font-medium hover:bg-zinc-800 transition"
      >
        Apply filters
      </button>
    </div>
  );
}

function Labeled({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-xs text-zinc-500 mb-1 block">{label}</span>
      {children}
    </label>
  );
}

function ResetRow({ onReset }: { onReset: () => void }) {
  return (
    <button
      type="button"
      onClick={onReset}
      className="mt-3 text-xs text-zinc-400 hover:text-zinc-700 transition"
    >
      Reset this filter
    </button>
  );
}
