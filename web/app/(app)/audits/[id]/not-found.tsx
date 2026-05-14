import Link from "next/link";

export default function AuditNotFound() {
  return (
    <div className="px-10 py-24 max-w-2xl text-center mx-auto">
      <div className="text-xs uppercase tracking-[0.25em] text-[var(--sky-700)] font-semibold mb-3">
        404
      </div>
      <h1 className="font-display text-4xl font-extrabold mb-2 tracking-tight">
        Audit not found.
      </h1>
      <p className="text-zinc-500 text-sm mb-8">
        It may have been deleted or the link is wrong.
      </p>
      <Link
        href="/audits"
        className="rounded-full bg-[var(--ink)] text-white px-6 py-2.5 text-sm font-medium hover:bg-zinc-800 transition inline-block"
      >
        Back to all audits
      </Link>
    </div>
  );
}
