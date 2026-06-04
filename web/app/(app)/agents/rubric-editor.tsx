"use client";

import { RUBRIC_DIMENSIONS } from "@/lib/rubric";

export type RubricRow = {
  key?: string;
  name: string;
  criteria: string;
  min: string;
  max: string;
};

// The built-in 10 dimensions, as editor rows — the starting point for a new
// agent and the "Reset to default" target.
export function defaultRubricRows(): RubricRow[] {
  return RUBRIC_DIMENSIONS.map((d) => ({
    key: d.key,
    name: d.name,
    criteria: d.criteria,
    min: String(d.min),
    max: String(d.max),
  }));
}

// Parse a stored rubric_json column into editor rows, or null if absent.
export function rubricRowsFromJson(
  raw: string | null | undefined,
): RubricRow[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    return parsed.map((d) => ({
      key: typeof d?.key === "string" ? d.key : undefined,
      name: String(d?.name ?? ""),
      criteria: String(d?.criteria ?? ""),
      min: String(d?.min ?? 1),
      max: String(d?.max ?? 5),
    }));
  } catch {
    return null;
  }
}

const inputCls =
  "w-full rounded-xl bg-[var(--paper)] border border-transparent focus:border-[var(--sky-500)] focus:bg-white px-3 py-2 text-sm focus:outline-none transition";

export default function RubricEditor({
  value,
  onChange,
}: {
  value: RubricRow[];
  onChange: (rows: RubricRow[]) => void;
}) {
  const update = (i: number, patch: Partial<RubricRow>) =>
    onChange(value.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const remove = (i: number) => onChange(value.filter((_, idx) => idx !== i));
  const add = () =>
    onChange([...value, { name: "", criteria: "", min: "1", max: "5" }]);

  return (
    <div>
      <div className="flex items-center justify-between mb-3 gap-3">
        <p className="text-xs text-zinc-500">
          The LLM scores each dimension within the min–max range you set.{" "}
          {value.length} dimension{value.length === 1 ? "" : "s"}.
        </p>
        <button
          type="button"
          onClick={() => onChange(defaultRubricRows())}
          className="shrink-0 text-xs text-zinc-500 hover:text-[var(--ink)] transition"
        >
          Reset to default
        </button>
      </div>

      <div className="space-y-3">
        {value.map((row, i) => (
          <div
            key={i}
            className="rounded-2xl bg-white border border-zinc-200 p-4"
          >
            <div className="flex items-start gap-3">
              <div className="flex-1 space-y-2 min-w-0">
                <input
                  type="text"
                  value={row.name}
                  onChange={(e) => update(i, { name: e.target.value })}
                  placeholder="Dimension name — e.g. Objection Handling"
                  className={`${inputCls} font-medium`}
                />
                <textarea
                  value={row.criteria}
                  onChange={(e) => update(i, { criteria: e.target.value })}
                  rows={2}
                  placeholder="What should the auditor grade for this dimension?"
                  className={inputCls}
                />
              </div>
              <div className="flex gap-2 shrink-0">
                <label className="block">
                  <span className="text-[10px] uppercase tracking-widest text-zinc-400 block mb-1">
                    Min
                  </span>
                  <input
                    type="number"
                    value={row.min}
                    onChange={(e) => update(i, { min: e.target.value })}
                    className="w-16 rounded-xl bg-[var(--paper)] border border-transparent focus:border-[var(--sky-500)] focus:bg-white px-2 py-2 text-sm text-center focus:outline-none transition"
                  />
                </label>
                <label className="block">
                  <span className="text-[10px] uppercase tracking-widest text-zinc-400 block mb-1">
                    Max
                  </span>
                  <input
                    type="number"
                    value={row.max}
                    onChange={(e) => update(i, { max: e.target.value })}
                    className="w-16 rounded-xl bg-[var(--paper)] border border-transparent focus:border-[var(--sky-500)] focus:bg-white px-2 py-2 text-sm text-center focus:outline-none transition"
                  />
                </label>
              </div>
              <button
                type="button"
                onClick={() => remove(i)}
                aria-label="Remove dimension"
                className="text-zinc-300 hover:text-rose-600 transition text-lg leading-none mt-6"
              >
                ✕
              </button>
            </div>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={add}
        className="mt-3 rounded-full bg-[var(--paper)] text-[var(--ink)] px-4 py-2 text-sm font-medium hover:bg-[var(--paper-strong)] transition"
      >
        + Add dimension
      </button>
    </div>
  );
}
