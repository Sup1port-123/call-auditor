import { createClient } from "@/lib/supabase/server";
import { ConvozenBatchUpload } from "@/components/ConvozenBatchUpload";

export const dynamic = "force-dynamic";

export default async function ConvozenBatchPage() {
  const supabase = await createClient();
  const { data: agents } = await supabase.from("agents").select("id, name").order("name");

  return (
    <div className="px-10 lg:px-16 py-14 max-w-4xl">
      <div className="mb-10">
        <div className="text-xs uppercase tracking-[0.25em] text-[var(--sky-700)] font-semibold mb-3">
          Convozen Import
        </div>
        <h1 className="font-display text-5xl md:text-6xl font-extrabold tracking-tight leading-[1.02]">
          Audit from{" "}
          <span className="bg-gradient-to-r from-[var(--violet-500)] via-[var(--pink-500)] to-[var(--sky-700)] bg-clip-text text-transparent">
            summaries.
          </span>
        </h1>
        <p className="text-zinc-500 mt-3 max-w-xl text-sm">
          Upload a Convozen call_details CSV export. Otis reads the pre-generated
          summaries and scores every call through Gemini — no recording URL or
          transcription step needed.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-10">
        {[
          { step: "1", icon: "📤", title: "Export from Convozen", desc: "Go to Convozen Reports and download the call_details CSV for the date range you want." },
          { step: "2", icon: "🤖", title: "Otis reads summaries", desc: "Otis extracts the summary column and sends each one directly to Gemini. No audio file required." },
          { step: "3", icon: "📊", title: "Scores appear in Batches", desc: "Each call gets a QA score, compliance check, strengths, and improvement notes." },
        ].map((s) => (
          <div key={s.step} className="rounded-2xl bg-[var(--paper)] p-5">
            <div className="text-2xl mb-2">{s.icon}</div>
            <div className="text-xs font-bold uppercase tracking-widest text-zinc-400 mb-1">Step {s.step}</div>
            <div className="font-semibold text-sm mb-1">{s.title}</div>
            <div className="text-xs text-zinc-500">{s.desc}</div>
          </div>
        ))}
      </div>

      <ConvozenBatchUpload agents={agents ?? []} />

      <div className="mt-6 text-center">
        <a href="/batches" className="text-xs text-zinc-400 hover:text-zinc-600 transition">Back to Batches</a>
        <span className="mx-3 text-zinc-200">·</span>
        <a href="/new-audit" className="text-xs text-zinc-400 hover:text-zinc-600 transition">Upload recording CSV instead</a>
      </div>
    </div>
  );
}
