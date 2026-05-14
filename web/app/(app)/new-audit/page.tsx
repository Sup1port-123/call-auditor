import Link from "next/link";
import SubmitForm from "./submit-form";

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
        Paste a recording URL, pick a preset, and Otis will transcribe with
        speaker diarization and score it against the rubric.
      </p>

      <SubmitForm />
    </div>
  );
}
