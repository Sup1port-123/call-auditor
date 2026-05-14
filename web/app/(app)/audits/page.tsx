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
    <div className="px-10 lg:px-16 py-14 max-w-6xl">
      <div className="flex items-end justify-between mb-10">
        <div>
          <div className="text-xs uppercase tracking-[0.25em] text-[var(--sky-700)] font-semibold mb-3">
            Audits
          </div>
          <h1 className="font-display text-5xl md:text-6xl font-extrabold tracking-tight leading-[1.02]">
            Every call,{" "}
            <span className="bg-gradient-to-r from-[var(--sky-700)] via-[var(--violet-500)] to-[var(--pink-500)] bg-clip-text text-transparent">
              scored.
            </span>
          </h1>
          <p className="text-zinc-500 mt-3 max-w-xl">
            Newest first. Click any row to open the full evaluation.
          </p>
        </div>
        <Link
          href="/new-audit"
          className="rounded-full bg-[var(--ink)] text-white px-6 py-2.5 text-sm font-medium hover:bg-zinc-800 transition shadow-[0_8px_24px_-12px_rgba(15,23,42,0.4)]"
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
          className="w-full rounded-2xl bg-[var(--paper)] border border-transparent focus:border-[var(--sky-500)] focus:bg-white px-5 py-3 text-sm focus:outline-none transition"
        />
      </form>

      {error && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 text-rose-700 text-sm px-5 py-3 mb-6">
          Couldn&apos;t load audits: {error.message}
        </div>
      )}

      {audits && audits.length > 0 ? (
        <AuditsTable rows={audits} />
      ) : (
        <div className="rounded-3xl bg-[var(--paper)] p-16 text-center">
          <div className="text-zinc-500 text-sm">
            {q ? `No audits matching "${q}".` : "No audits yet."}
          </div>
          {!q && (
            <Link
              href="/new-audit"
              className="inline-block mt-5 rounded-full bg-[var(--ink)] text-white px-6 py-2.5 text-sm font-medium hover:bg-zinc-800 transition"
            >
              + Run your first one
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
