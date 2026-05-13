import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

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
          <h1 className="text-3xl font-semibold">Audits</h1>
          <p className="text-zinc-400 mt-1 text-sm">
            Every call Otis has scored. Newest first.
          </p>
        </div>
        <Link
          href="/new-audit"
          className="rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 px-5 py-2 text-sm font-medium hover:opacity-90 transition"
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
          className="w-full rounded-md bg-zinc-900 border border-zinc-700 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-fuchsia-500"
        />
      </form>

      {error && (
        <div className="rounded-md border border-rose-500/40 bg-rose-500/10 text-rose-200 text-sm px-4 py-3 mb-6">
          Couldn&apos;t load audits: {error.message}
        </div>
      )}

      {audits && audits.length > 0 ? (
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-zinc-900/60 text-zinc-400">
              <tr>
                <Th>When</Th>
                <Th>Target</Th>
                <Th>Preset</Th>
                <Th>LLM</Th>
                <Th className="text-right pr-6">Score</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/80">
              {audits.map((row) => (
                <tr
                  key={row.id}
                  className="hover:bg-zinc-800/40 transition cursor-pointer"
                >
                  <Td className="text-zinc-400 whitespace-nowrap">
                    <Link href={`/audits/${row.id}`} className="block">
                      {new Date(row.timestamp).toLocaleDateString()}{" "}
                      <span className="text-zinc-600">
                        {new Date(row.timestamp).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </Link>
                  </Td>
                  <Td>
                    <Link href={`/audits/${row.id}`} className="block">
                      <div className="font-medium truncate max-w-xs">
                        {row.target}
                      </div>
                      {row.summary && (
                        <div className="text-zinc-500 text-xs truncate max-w-xs">
                          {row.summary}
                        </div>
                      )}
                    </Link>
                  </Td>
                  <Td className="text-zinc-400">
                    <Link href={`/audits/${row.id}`} className="block">
                      {row.preset || "—"}
                    </Link>
                  </Td>
                  <Td className="text-zinc-400">
                    <Link href={`/audits/${row.id}`} className="block">
                      {row.llm_provider || "—"}
                    </Link>
                  </Td>
                  <Td className="text-right pr-6">
                    <Link href={`/audits/${row.id}`} className="block">
                      <Score score={row.overall_score} />
                    </Link>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-zinc-800 bg-zinc-900/20 p-16 text-center">
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

function Th({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <th
      className={`text-left font-medium text-xs uppercase tracking-widest px-4 py-3 ${className ?? ""}`}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <td className={`px-4 py-3 ${className ?? ""}`}>{children}</td>;
}

function Score({ score }: { score: number | null }) {
  if (score == null) return <span className="text-xs text-zinc-500">—</span>;
  const tone =
    score >= 7
      ? "text-emerald-300"
      : score >= 5
      ? "text-amber-300"
      : "text-rose-300";
  return (
    <span className={`font-semibold tabular-nums ${tone}`}>{score}</span>
  );
}
