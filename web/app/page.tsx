import Link from "next/link";

export default function LandingPage() {
  return (
    <main className="min-h-screen bg-[radial-gradient(ellipse_at_top,_#1a0b2e_0%,_#0a0612_60%)] text-white flex flex-col items-center justify-center px-6">
      <p className="uppercase tracking-[0.2em] text-xs text-cyan-300 mb-6">
        Hi, I&apos;m Otis &middot; I audit AI calls so you don&apos;t have to
      </p>
      <h1 className="text-5xl md:text-7xl font-bold text-center max-w-3xl leading-tight">
        Are your AI calls{" "}
        <span className="bg-gradient-to-r from-cyan-300 via-fuchsia-400 to-amber-300 bg-clip-text text-transparent">
          doing it right
        </span>
        ?
      </h1>
      <p className="text-zinc-400 mt-6 max-w-xl text-center">
        Drop a recording. Otis transcribes it with speaker diarization, scores
        it against your rubric, and tells you exactly where your AI nailed it
        &mdash; or fumbled.
      </p>
      <Link
        href="/dashboard"
        className="mt-10 inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 px-8 py-3 text-base font-medium hover:opacity-90 transition"
      >
        Let&apos;s find out &rarr;
      </Link>
    </main>
  );
}
