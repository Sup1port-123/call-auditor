import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import LottiePlayer from "@/components/lottie-player";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function DashboardPage() {
  const supabase = await createClient();

  const since = new Date();
  since.setDate(since.getDate() - 7);

  const [{ count: weekCount }, { count: totalCount }, { data: recent }] =
    await Promise.all([
      supabase
        .from("audits")
        .select("*", { count: "exact", head: true })
        .gte("timestamp", since.toISOString()),
      supabase.from("audits").select("*", { count: "exact", head: true }),
      supabase
        .from("audits")
        .select("id, timestamp, target, llm_provider, overall_score")
        .order("timestamp", { ascending: false })
        .limit(5),
    ]);

  const { data: scored } = await supabase
    .from("audits")
    .select("overall_score")
    .not("overall_score", "is", null);

  const avgScore =
    scored && scored.length > 0
      ? scored.reduce((a, r) => a + (r.overall_score ?? 0), 0) / scored.length
      : null;

  const cards = [
    { label: "Audits this week", value: weekCount?.toLocaleString() ?? "0" },
    {
      label: "Avg score",
      value: avgScore != null ? avgScore.toFixed(1) : "—",
    },
    { label: "All time", value: totalCount?.toLocaleString() ?? "0" },
  ];

  return (
    <div className="px-10 py-12 max-w-6xl">
      <div className="flex items-end justify-between mb-12">
        <div>
          <h1 className="text-3xl font-semibold">Dashboard</h1>
          <p className="text-zinc-400 mt-1 text-sm">
            What your AI calls have been up to.
          </p>
        </div>
        <Link
          href="/new-audit"
          className="rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 px-5 py-2 text-sm font-medium hover:opacity-90 transition"
        >
          + New audit
        </Link>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-12">
        {cards.map((card) => (
          <div
            key={card.label}
            className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-6"
          >
            <div className="text-xs uppercase tracking-widest text-zinc-500">
              {card.label}
            </div>
            <div className="text-3xl font-semibold mt-2 tabular-nums">
              {card.value}
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-medium">Recent audits</h2>
        <Link
          href="/audits"
          className="text-sm text-zinc-400 hover:text-white transition"
        >
          View all &rarr;
        </Link>
      </div>

      {recent && recent.length > 0 ? (
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 divide-y divide-zinc-800">
          {recent.map((row) => (
            <Link
              key={row.id}
              href={`/audits/${row.id}`}
              className="flex items-center justify-between px-5 py-4 hover:bg-zinc-800/40 transition"
            >
              <div className="min-w-0 flex-1 mr-6">
                <div className="text-sm font-medium truncate">{row.target}</div>
                <div className="text-xs text-zinc-500 mt-0.5">
                  {new Date(row.timestamp).toLocaleString()} ·{" "}
                  {row.llm_provider ?? "unknown"}
                </div>
              </div>
              <ScorePill score={row.overall_score} />
            </Link>
          ))}
        </div>
      ) : (
        <EmptyState />
      )}
    </div>
  );
}

function ScorePill({ score }: { score: number | null }) {
  if (score == null) {
    return <span className="text-xs text-zinc-500">no score</span>;
  }
  const tone =
    score >= 7
      ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/30"
      : score >= 5
      ? "bg-amber-500/20 text-amber-300 border-amber-500/30"
      : "bg-rose-500/20 text-rose-300 border-rose-500/30";
  return (
    <span
      className={`rounded-full border px-3 py-1 text-xs font-medium tabular-nums ${tone}`}
    >
      {score}/10
    </span>
  );
}

function EmptyState() {
  return (
    <div className="rounded-2xl border border-dashed border-zinc-800 bg-zinc-900/20 p-12 flex flex-col md:flex-row items-center gap-8">
      <LottiePlayer
        src="/lottie/hey.lottie"
        className="w-40 h-40 shrink-0"
      />
      <div className="text-center md:text-left">
        <div className="text-lg font-medium">Hi, I&apos;m Otis.</div>
        <div className="text-zinc-400 text-sm mt-1 max-w-md">
          Drop a recording URL and I&apos;ll transcribe it with speaker
          diarization, score it against the rubric, and surface what your
          AI agent nailed or fumbled.
        </div>
        <Link
          href="/new-audit"
          className="inline-flex items-center gap-2 mt-5 rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 px-5 py-2 text-sm font-medium hover:opacity-90 transition"
        >
          Run your first audit &rarr;
        </Link>
      </div>
    </div>
  );
}
