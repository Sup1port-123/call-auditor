"use client";
import { useState, useRef } from "react";

interface Agent { id: string; name: string; }
interface BatchResult { batchId: string; total: number; completed: number; failed: number; skipped: number; }

export function ConvozenBatchUpload({ agents }: { agents: Agent[] }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [agentId, setAgentId] = useState("");
  const [batchName, setBatchName] = useState("");
  const [customFocus, setCustomFocus] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<BatchResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  function handleFile(f: File | null) {
    if (!f) return;
    if (!f.name.endsWith(".csv")) { setError("Please upload a .csv file from Convozen."); return; }
    setError(null);
    setFile(f);
    if (!batchName) setBatchName("Convozen Inbound - " + new Date().toISOString().slice(0, 10));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) { setError("Please select a CSV file."); return; }
    setLoading(true); setError(null); setResult(null);
    const fd = new FormData();
    fd.append("file", file);
    if (agentId) fd.append("agentId", agentId);
    fd.append("batchName", batchName || ("Convozen Import " + new Date().toISOString().slice(0, 10)));
    fd.append("preset", "general");
    fd.append("strictness", "standard");
    if (customFocus) fd.append("customFocus", customFocus);
    try {
      const res = await fetch("/api/convozen-batch", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) setError(data.error ?? "Server error (" + res.status + ")");
      else setResult(data as BatchResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally { setLoading(false); }
  }

  return (
    <div className="rounded-3xl bg-[var(--paper)] p-8 max-w-2xl">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-2xl bg-violet-100 flex items-center justify-center text-xl">🗂️</div>
        <div>
          <div className="font-display text-lg font-bold">Convozen CSV Audit</div>
          <div className="text-xs text-zinc-500">Upload a Convozen call_details export — no recording URL needed</div>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        <div
          className={"relative rounded-2xl border-2 border-dashed transition cursor-pointer text-center p-8 " + (dragging ? "border-violet-500 bg-violet-50" : file ? "border-emerald-400 bg-emerald-50" : "border-zinc-200 hover:border-zinc-400")}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); handleFile(e.dataTransfer.files?.[0] ?? null); }}
          onClick={() => fileRef.current?.click()}
        >
          <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={(e) => handleFile(e.target.files?.[0] ?? null)} />
          {file ? (
            <><div className="text-2xl mb-1">✅</div><div className="font-medium text-sm text-emerald-700">{file.name}</div><div className="text-xs text-zinc-400 mt-1">{(file.size / 1024).toFixed(1)} KB — click to change</div></>
          ) : (
            <><div className="text-2xl mb-1">📂</div><div className="text-sm text-zinc-600 font-medium">Drop Convozen CSV here or click to browse</div><div className="text-xs text-zinc-400 mt-1">Expects columns: callId, summary, phoneNumber, callDuration (mins)</div></>
          )}
        </div>

        <div>
          <label className="block text-xs font-semibold uppercase tracking-widest text-zinc-400 mb-1.5">Batch name</label>
          <input type="text" value={batchName} onChange={(e) => setBatchName(e.target.value)} placeholder="e.g. Convozen Inbound - 21 Sep 2026" className="w-full rounded-xl border border-zinc-200 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400" />
        </div>

        {agents.length > 0 && (
          <div>
            <label className="block text-xs font-semibold uppercase tracking-widest text-zinc-400 mb-1.5">Agent (optional)</label>
            <select value={agentId} onChange={(e) => setAgentId(e.target.value)} className="w-full rounded-xl border border-zinc-200 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400 bg-white">
              <option value="">— No agent / default rubric —</option>
              {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
        )}

        <div>
          <label className="block text-xs font-semibold uppercase tracking-widest text-zinc-400 mb-1.5">Audit focus (optional)</label>
          <input type="text" value={customFocus} onChange={(e) => setCustomFocus(e.target.value)} placeholder="e.g. Focus on call resolution and language quality" className="w-full rounded-xl border border-zinc-200 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400" />
        </div>

        <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-xs text-amber-800">
          <strong>Note:</strong> Convozen summaries miss tone, code-switching, and call-closure nuances. Scores are directional — use recording-based audits for deep QA.
        </div>

        {error && <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-xs text-red-700">{error}</div>}

        {result && (
          <div className="rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-4 text-sm">
            <div className="font-semibold text-emerald-800 mb-2">✅ Batch created — scoring in progress</div>
            <div className="grid grid-cols-4 gap-3 text-center">
              {[{ label: "Total", value: result.total }, { label: "Completed", value: result.completed }, { label: "Failed", value: result.failed }, { label: "Skipped", value: result.skipped }].map(s => (
                <div key={s.label} className="rounded-lg bg-white border border-emerald-100 py-2">
                  <div className="font-bold text-lg text-emerald-700">{s.value}</div>
                  <div className="text-[10px] text-zinc-500 uppercase tracking-wider">{s.label}</div>
                </div>
              ))}
            </div>
            <a href={"/batches/" + result.batchId} className="mt-3 block text-center text-xs font-semibold text-violet-600 hover:underline">View batch →</a>
          </div>
        )}

        <button type="submit" disabled={loading || !file} className="w-full rounded-full bg-[var(--ink)] text-white py-3 text-sm font-semibold hover:bg-zinc-800 transition disabled:opacity-40 disabled:cursor-not-allowed">
          {loading ? "Uploading & scoring..." : "Start Convozen Audit"}
        </button>
      </form>
    </div>
  );
}
