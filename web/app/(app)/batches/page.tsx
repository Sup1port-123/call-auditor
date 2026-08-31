// app/batches/page.tsx  (replace the existing file with this)
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { istDateTime } from "@/lib/datetime";
import { BatchTrashButton } from "@/components/BatchTrashButton";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function BatchesPage() {
  const supabase = await createClient();

  const [
    { data: batches },
    { data: auditMeta },
    { data: agents },
    {
      data: { user },
    },
  ] = await Promise.all([
    supabase
      .from("batches")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200),
    supabase
      .from("audits")
      .select("batch_id, status, overall_score")
      .not("batch_id", "is", null),
    supabase.from("agents").select("id, name"),
    supabase.auth.getUser(),
  ]);

  const adminEmail = process.env.ADMIN_EMAIL ?? "";
  const isAdmin = !!user?.email && !!adminEmail && user.email === adminEmail;

  const agentMap = new Map<string, string>(
    (agents ?? []).map((a) => [a.id as string, a.name as string])
  );

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

  const activeBatches = (batches ?? []).filter((b) => !b.deleted_at);
  const trashedBatches = (batches ?? []).filter((b) => b.deleted_at);

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

      {activeBatches.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {activeBatches.map((b, i) => {
            const t = tally.get(b.id);
            const avg =
              t && t.scoreN > 0 ? (t.scoreSum / t.scoreN).toFixed(1) : "—";
            const completed = t?.completed ?? 0;
            const agentName = b.agent_id ? agentMap.get(b.agent_id) : null;
            return (
              <div key={b.id} className="relative">
                <Link
                  href={`/batches/${b.id}`}
                  className="relative block rounded-3xl bg-[var(--paper)] p-6 hover:bg-zinc-100 transition group"
                >
                  <span className="absolute top-5 right-6 font-mono text-xs text-zinc-400">
                    ({String(i + 1).padStart(2, "0")})
                  </span>
                  <div className="font-display text-lg font-bold truncate pr-10">
                    {b.label || "Untitled batch"}
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <div className="text-xs text-zinc-500">
                      {istDateTime(b.created_at)} IST
                    </div>
                    {agentName && (
                      <>
                        <span className="text-zinc-300">·</span>
                        <div className="text-xs font-medium text-[var(--sky-700)] truncate">
                          {agentName}
                        </div>
                      </>
                    )}
                  </div>
                  <div className="flex items-center gap-5 mt-5">
                    <Stat label="Recordings" value={String(b.total)} />
                    <Stat label="Completed" value={`${completed}/${b.total}`} />
                    <Stat label="Avg score" value={avg} />
                  </div>
                  <BatchTrashButton batchId={b.id} trashed={false} isAdmin={isAdmin} />
                </Link>
              </div>
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

      {isAdmin && trashedBatches.length > 0 && (
        <div className="mt-16">
          <div className="flex items-center gap-3 mb-5">
            <div className="text-xs uppercase tracking-[0.25em] text-zinc-400 font-semibold">
              Trash
            </div>
            <div className="h-px flex-1 bg-zinc-200" />
            <div className="text-xs text-zinc-400">
              {trashedBatches.length} batch{trashedBatches.length !== 1 ? "es" : ""}
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {trashedBatches.map((b) => {
              const t = tally.get(b.id);
              const avg = t && t.scoreN > 0 ? (t.scoreSum / t.scoreN).toFixed(1) : "—";
              const completed = t?.completed ?? 0;
              const agentName = b.agent_id ? agentMap.get(b.agent_id) : null;
              return (
                <div key={b.id} className="rounded-3xl bg-[var(--paper)] p-6 opacity-60">
                  <div className="font-display text-lg font-bold truncate text-zinc-500">
                    {b.label || "Untitled batch"}
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <div className="text-xs text-zinc-400">{istDateTime(b.created_at)} IST</div>
                    {agentName && (
                      <>
                        <span className="text-zinc-300">·</span>
                        <div className="text-xs font-medium text-zinc-400 truncate">{agentName}</div>
                      </>
                    )}
                  </div>
                  <div className="flex items-center gap-5 mt-4">
                    <Stat label="Recordings" value={String(b.total)} />
                    <Stat label="Completed" value={`${completed}/${b.total}`} />
                    <Stat label="Avg score" value={avg} />
                  </div>
                  <BatchTrashButton batchId={b.id} trashed={true} isAdmin={isAdmin} />
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-widest text-zinc-400">{label}</div>
      <div className="font-display text-xl font-bold tabular-nums mt-0.5">{value}</div>
    </div>
  );
}
