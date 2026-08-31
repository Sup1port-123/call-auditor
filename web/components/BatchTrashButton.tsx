"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Props {
  batchId: string;
  trashed: boolean;
  isAdmin: boolean;
}

export function BatchTrashButton({ batchId, trashed, isAdmin }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirmDestroy, setConfirmDestroy] = useState(false);

  if (!isAdmin) return null;

  async function callApi(action: "trash" | "restore" | "destroy") {
    setBusy(true);
    try {
      const res = await fetch(`/api/batches/${batchId}/trash`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) {
        const { error } = await res.json();
        alert(`Failed: ${error}`);
        return;
      }
      router.refresh();
    } catch (e) {
      alert("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
      setConfirmDestroy(false);
    }
  }

  if (!trashed) {
    return (
      <button
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (busy) return;
          callApi("trash");
        }}
        disabled={busy}
        title="Move to trash"
        className="
          absolute bottom-5 right-5 z-10
          w-8 h-8 flex items-center justify-center
          rounded-full
          text-zinc-400 hover:text-red-500 hover:bg-red-50
          transition opacity-0 group-hover:opacity-100
          disabled:opacity-30
        "
      >
        {busy ? <SpinnerIcon /> : <TrashIcon />}
      </button>
    );
  }

  return (
    <div
      className="flex gap-2 mt-4"
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
    >
      <button
        onClick={() => !busy && callApi("restore")}
        disabled={busy}
        className="flex-1 text-xs font-medium rounded-full px-3 py-1.5 bg-zinc-200 hover:bg-zinc-300 text-zinc-700 disabled:opacity-40 transition"
      >
        {busy ? "…" : "Restore"}
      </button>

      {!confirmDestroy ? (
        <button
          onClick={() => setConfirmDestroy(true)}
          disabled={busy}
          className="flex-1 text-xs font-medium rounded-full px-3 py-1.5 bg-red-100 hover:bg-red-200 text-red-700 disabled:opacity-40 transition"
        >
          Delete forever
        </button>
      ) : (
        <button
          onClick={() => !busy && callApi("destroy")}
          disabled={busy}
          className="flex-1 text-xs font-semibold rounded-full px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white disabled:opacity-40 transition animate-pulse"
        >
          {busy ? "Deleting…" : "Confirm — cannot undo"}
        </button>
      )}
    </div>
  );
}

function TrashIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
      <path fillRule="evenodd" d="M8.75 1A2.75 2.75 0 006 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 10.23 1.482l.149-.022.841 10.518A2.75 2.75 0 007.596 19h4.807a2.75 2.75 0 002.742-2.53l.841-10.52.149.023a.75.75 0 00.23-1.482A41.03 41.03 0 0014 4.193V3.75A2.75 2.75 0 0011.25 1h-2.5zM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4zM8.58 7.72a.75.75 0 00-1.5.06l.3 7.5a.75.75 0 101.5-.06l-.3-7.5zm4.34.06a.75.75 0 10-1.5-.06l-.3 7.5a.75.75 0 101.5.06l.3-7.5z" clipRule="evenodd" />
    </svg>
  );
}

function SpinnerIcon() {
  return (
    <svg className="w-4 h-4 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
    </svg>
  );
}
