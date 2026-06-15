import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { istDateTime } from "@/lib/datetime";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function BatchesPage() {
  const supabase = await createClient();

  const [{ data: batches }, { data: auditMeta }] = await Promise.all([
    supabase
      .from("batches")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100),
    supabase
      .from("audits")
      .select("batch_id, status, overall_score")
      .not("batch_id", "is", null),
  ]);

  // Tally completed count + avg score per batch.
  const tally = new Map<
    string,
    { completed: number; scoreSum: number; scoreN: number }
  >();
  for (const a of auditMeta ?? []) {
    const bid = a.batch_id as string;
    if (!bid) continue;
    const t = tally.get(bid) ?? { completed: 0, scoreSum: 0, scoreN: 0 };
    if (a.status === "completed") t.completed += 1;
    if (typeof a.overall_score === "number") {
      t.scoreSum += a.overall_score;
      t.scoreN += 1;
    }
    tally.set(bid, t);
  }

  return (
    <div className="px-10 lg:px-16 py-14 max-w-6xl">
      <div className="flex items-end justify-between mb-10">
        <div>
          <div className="text-xs uppercase tracking-[0.25em] text-[var(--sky-700)] font-semibold mb-3">
            Batches
          </div>
          <h1 className="font-display text-5xl md:text-6xl font-extrabold tracking-tight leading-[1.02]">
            Audited in{" "}
            <span className="bg-gradient-to-r from-[var(--sky-700)] via-[var(--violet-500)] to-[var(--pink-500)] bg-clip-text text-transparent">
              bulk.
            </span>
          </h1>
          <p className="text-zinc-500 mt-3 max-w-xl">
            Upload a spreadsheet of recording URLs and Otis audits every row.
          </p>
        </div>
        <Link
          href="/new-audit"
          className="rounded-full bg-[var(--ink)] text-white px-6 py-2.5 text-sm font-medium hover:bg-zinc-800 transition shadow-[0_8px_24px_-12px_rgba(15,23,42,0.4)]"
        >
          + New batch
        </Link>
      </div>

      {batches && batches.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {batches.map((b, i) => {
            const t = tally.get(b.id);
            const avg =
              t && t.scoreN > 0 ? (t.scoreSum / t.scoreN).toFixed(1) : "—";
            const completed = t?.completed ?? 0;
            return (
              <Link
                key={b.id}
                href={`/batches/${b.id}`}
                className="relative rounded-3xl bg-[var(--paper)] p-6 hover:bg-zinc-100 transition group"
              >
                <span className="absolute top-5 right-6 font-mono text-xs text-zinc-400">
                  ({String(i + 1).padStart(2, "0")})
                </span>
                <div className="font-display text-lg font-bold truncate pr-10">
                  {b.label || "Untitled batch"}
                </div>
                <div className="text-xs text-zinc-500 mt-1">
                  {istDateTime(b.created_at)} IST
                </div>
                <div className="flex items-center gap-5 mt-5">
                  <Stat label="Recordings" value={String(b.total)} />
                  <Stat label="Completed" value={`${completed}/${b.total}`} />
                  <Stat label="Avg score" value={avg} />
                </div>
              </Link>
            );
          })}
        </div>
      ) : (
        <div className="rounded-3xl bg-[var(--paper)] p-16 text-center">
          <div className="text-zinc-500 text-sm">No batches yet.</div>
          <Link
            href="/new-audit"
            className="inline-block mt-5 rounded-full bg-[var(--ink)] text-white px-6 py-2.5 text-sm font-medium hover:bg-zinc-800 transition"
          >
            + Upload a spreadsheet
          </Link>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-widest text-zinc-400">
        {label}
      </div>
      <div className="font-display text-xl font-bold tabular-nums mt-0.5">
        {value}
      </div>
    </div>
  );
}
