"use client";

import { useState } from "react";
import SubmitForm from "./submit-form";
import BatchForm from "./batch-form";
import UploadForm from "./upload-form";

type Mode = "single" | "batch" | "upload";

export default function NewAuditTabs({
  agents,
  defaultAgentId,
}: {
  agents: { id: string; name: string }[];
  defaultAgentId: string;
}) {
  const [mode, setMode] = useState<Mode>("single");
  // A spreadsheet dropped on "Upload file" is handed to the batch form.
  const [spreadsheet, setSpreadsheet] = useState<File | null>(null);

  return (
    <div>
      <div className="inline-flex rounded-full bg-[var(--paper)] p-1 mb-8">
        <TabButton
          active={mode === "single"}
          onClick={() => setMode("single")}
          label="Single URL"
        />
        <TabButton
          active={mode === "batch"}
          onClick={() => setMode("batch")}
          label="Upload spreadsheet"
        />
        <TabButton
          active={mode === "upload"}
          onClick={() => setMode("upload")}
          label="Upload file"
        />
      </div>

      {mode === "single" ? (
        <SubmitForm agents={agents} defaultAgentId={defaultAgentId} />
      ) : mode === "batch" ? (
        <BatchForm
          key={spreadsheet ? spreadsheet.name + spreadsheet.lastModified : "empty"}
          agents={agents}
          defaultAgentId={defaultAgentId}
          initialFile={spreadsheet}
        />
      ) : (
        <UploadForm
          agents={agents}
          defaultAgentId={defaultAgentId}
          onSpreadsheet={(f) => {
            setSpreadsheet(f);
            setMode("batch");
          }}
        />
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-5 py-2 text-sm font-medium transition ${
        active
          ? "bg-[var(--ink)] text-white"
          : "text-zinc-600 hover:text-[var(--ink)]"
      }`}
    >
      {label}
    </button>
  );
}
