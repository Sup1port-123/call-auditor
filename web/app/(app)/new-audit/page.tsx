import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import SubmitForm from "./submit-form";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function NewAuditPage({
  searchParams,
}: {
  searchParams: Promise<{ agent?: string }>;
}) {
  const { agent } = await searchParams;
  const supabase = await createClient();
  const { data: agents } = await supabase
    .from("agents")
    .select("id, name")
    .order("created_at", { ascending: false });

  return (
    <div className="px-10 lg:px-16 py-14 max-w-3xl">
      <Link
        href="/dashboard"
        className="text-xs uppercase tracking-[0.25em] text-zinc-400 hover:text-zinc-600 transition inline-block mb-6"
      >
        &larr; Dashboard
      </Link>

      <div className="mb-12">
        <div className="text-xs uppercase tracking-[0.25em] text-[var(--sky-700)] font-semibold mb-3">
          New audit
        </div>
        <h1 className="font-display text-5xl font-extrabold tracking-tight leading-[1.02]">
          Drop a recording.{" "}
          <span className="bg-gradient-to-r from-[var(--sky-700)] via-[var(--violet-500)] to-[var(--pink-500)] bg-clip-text text-transparent">
            I&apos;ll do the rest.
          </span>
        </h1>
        <p className="text-zinc-500 mt-4 max-w-xl">
          I&apos;ll transcribe with speaker diarization and grade the call
          against every dimension of your rubric.
        </p>
      </div>

      <SubmitForm agents={agents ?? []} defaultAgentId={agent ?? ""} />
    </div>
  );
}
