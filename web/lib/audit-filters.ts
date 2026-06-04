// Dashboard audit filters: parse URL search params into a normalized shape,
// and a few helpers shared by the server page and the filter UI.
//
// Filters (all optional, freely combined):
//   • date     — last N days, and/or an explicit from/to range
//   • callIds  — match the recording URL (target) against any of N ids/fragments
//   • duration — recording length in seconds (gt / lt / eq / between)
//   • score    — overall audit score 0–10 (gt / lt / eq / between)

export type RangeOp = "gt" | "lt" | "eq" | "between";
export type DurUnit = "sec" | "min";

export type AuditFilters = {
  // Date
  days: number | null;
  from: string | null; // yyyy-mm-dd
  to: string | null; // yyyy-mm-dd
  // Call id / URL fragments
  callIds: string[];
  // Duration (always normalized to seconds for querying)
  durOp: RangeOp | null;
  durMin: number | null; // seconds
  durMax: number | null; // seconds
  durUnit: DurUnit; // how the user entered it (for redisplay only)
  // Score
  scoreOp: RangeOp | null;
  scoreMin: number | null;
  scoreMax: number | null;
  // Manual review state (any subset of reviewed/not_reviewed/flagged)
  reviewStatuses: string[];
};

const REVIEW_VALUES = new Set(["reviewed", "not_reviewed", "flagged"]);

export type RawParams = Record<string, string | undefined>;

function num(v: string | undefined): number | null {
  if (v == null || v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function op(v: string | undefined): RangeOp | null {
  return v === "gt" || v === "lt" || v === "eq" || v === "between" ? v : null;
}

// Strip the characters that would break a PostgREST `or=()` filter string.
export function sanitizeCallId(s: string): string {
  return s.replace(/[,()*]/g, "").trim();
}

export function parseCallIds(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(/[\n,]/)
    .map(sanitizeCallId)
    .filter((s) => s.length > 0)
    .slice(0, 100);
}

export function parseAuditFilters(p: RawParams): AuditFilters {
  const durUnit: DurUnit = p.durUnit === "min" ? "min" : "sec";
  const toSecs = (n: number | null) =>
    n == null ? null : durUnit === "min" ? Math.round(n * 60) : Math.round(n);

  return {
    days: num(p.days),
    from: p.from?.trim() || null,
    to: p.to?.trim() || null,
    callIds: parseCallIds(p.callIds),
    durOp: op(p.durOp),
    durMin: toSecs(num(p.durMin)),
    durMax: toSecs(num(p.durMax)),
    durUnit,
    scoreOp: op(p.scoreOp),
    scoreMin: num(p.scoreMin),
    scoreMax: num(p.scoreMax),
    reviewStatuses: (p.review ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => REVIEW_VALUES.has(s)),
  };
}

export function hasAnyFilter(f: AuditFilters): boolean {
  return (
    f.days != null ||
    f.from != null ||
    f.to != null ||
    f.callIds.length > 0 ||
    (f.durOp != null && (f.durMin != null || f.durMax != null)) ||
    (f.scoreOp != null && (f.scoreMin != null || f.scoreMax != null)) ||
    f.reviewStatuses.length > 0
  );
}

// Build the lower/upper timestamp bounds (ISO) from the date filters.
// `days` and `from` both lower-bound; the stricter one wins (PostgREST ANDs
// repeated filters). `to` upper-bounds at end-of-day.
export function dateBounds(f: AuditFilters): { gte?: string; lte?: string } {
  const out: { gte?: string; lte?: string } = {};
  const lowers: number[] = [];
  if (f.days != null && f.days > 0) {
    lowers.push(Date.now() - f.days * 24 * 60 * 60 * 1000);
  }
  if (f.from) {
    const d = new Date(`${f.from}T00:00:00`);
    if (!Number.isNaN(d.getTime())) lowers.push(d.getTime());
  }
  if (lowers.length > 0) {
    out.gte = new Date(Math.max(...lowers)).toISOString();
  }
  if (f.to) {
    const d = new Date(`${f.to}T23:59:59.999`);
    if (!Number.isNaN(d.getTime())) out.lte = d.toISOString();
  }
  return out;
}

// PostgREST `or=()` clause matching target against any call id, or null.
export function callIdOrClause(f: AuditFilters): string | null {
  if (f.callIds.length === 0) return null;
  return f.callIds.map((id) => `target.ilike.*${id}*`).join(",");
}

// Minimal, NON-recursive shape of a PostgREST filter builder. Kept tiny on
// purpose: an F-bounded generic (<T extends Self<T>>) makes tsc instantiate
// the giant PostgrestFilterBuilder type recursively and bail with "Type
// instantiation is excessively deep and possibly infinite."
interface FilterChain {
  gte(column: string, value: number | string): unknown;
  lte(column: string, value: number | string): unknown;
  gt(column: string, value: number | string): unknown;
  lt(column: string, value: number | string): unknown;
  eq(column: string, value: number | string): unknown;
  or(filters: string): unknown;
  in(column: string, values: readonly (number | string)[]): unknown;
}

// Apply every active filter to a query, then return the SAME query. Shared by
// the dashboard page and the Excel export route so they always agree on what
// "matching" means. supabase-js filter methods mutate the builder in place and
// return `this`, so we operate through a small cast and hand back the original
// (fully-typed) builder. Must be called BEFORE .order()/.limit().
export function applyAuditFilters<T>(query: T, f: AuditFilters): T {
  const q = query as unknown as FilterChain;

  const b = dateBounds(f);
  if (b.gte) q.gte("timestamp", b.gte);
  if (b.lte) q.lte("timestamp", b.lte);

  const orClause = callIdOrClause(f);
  if (orClause) q.or(orClause);

  if (f.reviewStatuses.length > 0) q.in("review_status", f.reviewStatuses);

  if (f.durOp) {
    // Exclude nulls and the -1 "unknown" backfill sentinel.
    q.gte("duration_seconds", 0);
    const v = f.durMin;
    if (f.durOp === "gt" && v != null) q.gt("duration_seconds", v);
    else if (f.durOp === "lt" && v != null) q.lt("duration_seconds", v);
    else if (f.durOp === "eq" && v != null) q.eq("duration_seconds", v);
    else if (f.durOp === "between") {
      if (f.durMin != null) q.gte("duration_seconds", f.durMin);
      if (f.durMax != null) q.lte("duration_seconds", f.durMax);
    }
  }

  if (f.scoreOp) {
    const v = f.scoreMin;
    if (f.scoreOp === "gt" && v != null) q.gt("overall_score", v);
    else if (f.scoreOp === "lt" && v != null) q.lt("overall_score", v);
    else if (f.scoreOp === "eq" && v != null) q.eq("overall_score", v);
    else if (f.scoreOp === "between") {
      if (f.scoreMin != null) q.gte("overall_score", f.scoreMin);
      if (f.scoreMax != null) q.lte("overall_score", f.scoreMax);
    }
  }

  return query;
}

// Format seconds as a compact duration. -1 / null → unknown.
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || seconds < 0) return "—";
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  }
  return `${m}:${String(sec).padStart(2, "0")}`;
}
