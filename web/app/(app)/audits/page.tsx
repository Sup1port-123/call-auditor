import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import AuditsTable from "./audits-table";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const PAGE_SIZE = 50;

export default async function AuditsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const supabase = await createClient();

  let query = supabase
    .from("audits")
    .select(
      "id, timestamp, target, preset, llm_provider, overall_score, summary",
    )
    .order("timestamp", { ascending: false })
    .limit(PAGE_SIZE);

  if (q?.trim()) {
    query = query.ilike("target", `%${q.trim()}%`);
  }

  const { data: audits, error } = await query;

  return (
    <div className="px-10 py-12 max-w-6xl">
      <div className="flex items-end justify-between mb-8">
        <div>
          <h1 className="text-3xl font-semibold">
            <span className="bg-gradient-to-r from-white to-zinc-400 bg-clip-text text-transparent">
              Audits
            </span>
          </h1>
          <p className="text-zinc-400 mt-1 text-sm">
            Every call Otis has scored. Newest first.
          </p>
        </div>
        <Link
          href="/new-audit"
          className="rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 px-5 py-2 text-sm font-medium hover:opacity-90 hover:scale-[1.02] transition shadow-[0_0_30px_-12px_rgba(232,121,249,0.6)]"
        >
          + New audit
        </Link>
      </div>

      <form className="mb-6">
        <input
          name="q"
          type="search"
          defaultValue={q ?? ""}
          placeholder="Search recording filename or URL…"
          className="w-full rounded-md bg-zinc-900/60 backdrop-blur-md border border-white/10 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-fuchsia-500"
        />
      </form>

      {error && (
        <div className="rounded-md border border-rose-500/40 bg-rose-500/10 text-rose-200 text-sm px-4 py-3 mb-6">
          Couldn&apos;t load audits: {error.message}
        </div>
      )}

      {audits && audits.length > 0 ? (
        <AuditsTable rows={audits} />
      ) : (
        <div className="rounded-2xl border border-dashed border-white/10 bg-zinc-900/20 backdrop-blur-md p-16 text-center">
          <div className="text-zinc-400 text-sm">
            {q ? `No audits matching "${q}".` : "No audits yet."}
          </div>
          {!q && (
            <Link
              href="/new-audit"
              className="inline-block mt-4 text-sm text-fuchsia-300 hover:text-fuchsia-200 transition"
            >
              Run your first one &rarr;
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
