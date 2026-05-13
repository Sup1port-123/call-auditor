import Link from "next/link";

export default function AuditNotFound() {
  return (
    <div className="px-10 py-24 max-w-2xl text-center mx-auto">
      <h1 className="text-2xl font-semibold mb-2">Audit not found.</h1>
      <p className="text-zinc-400 text-sm mb-8">
        It may have been deleted or the link is wrong.
      </p>
      <Link
        href="/audits"
        className="rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 px-5 py-2 text-sm font-medium hover:opacity-90 transition inline-block"
      >
        Back to all audits
      </Link>
    </div>
  );
}
