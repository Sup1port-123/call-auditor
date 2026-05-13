import Link from "next/link";

const STREAMLIT_URL = "https://otis-auditor.streamlit.app";

export default function NewAuditPage() {
  return (
    <div className="px-10 py-12 max-w-3xl">
      <Link
        href="/dashboard"
        className="text-xs text-zinc-500 hover:text-zinc-300 transition inline-block mb-6"
      >
        &larr; Dashboard
      </Link>

      <h1 className="text-3xl font-semibold mb-2">Run a new audit</h1>
      <p className="text-zinc-400 text-sm mb-10">
        The new in-app audit flow lands in the next phase. For now, run it
        on the Streamlit app &mdash; results land in the same database, so
        they&apos;ll appear here in Audits when done.
      </p>

      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-8 space-y-6">
        <div className="flex items-start gap-4">
          <span className="text-2xl">🎙</span>
          <div>
            <h2 className="font-medium">Drop a recording in the legacy app</h2>
            <p className="text-zinc-400 text-sm mt-1">
              Same transcription, same rubric, same scoring &mdash; Otis on
              Streamlit. Audits sync to this dashboard automatically.
            </p>
          </div>
        </div>

        <a
          href={STREAMLIT_URL}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 px-6 py-2.5 text-sm font-medium hover:opacity-90 transition"
        >
          Open Streamlit auditor &rarr;
        </a>
      </div>

      <div className="mt-10 text-xs text-zinc-500">
        Coming next: in-app upload, live transcription progress, side-by-side
        dimension scoring, sharable audit links.
      </div>
    </div>
  );
}
