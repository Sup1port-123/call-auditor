"use client";

import { useState } from "react";
import SubmitForm from "./submit-form";
import BatchForm from "./batch-form";
import UploadForm from "./upload-form";
import { ConvozenBatchUpload } from "@/components/ConvozenBatchUpload";

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
  // A Convozen export dropped on either upload tab is audited here from its
  // transcript/summary text, so Karta and Convozen files share one page.
  const [convozenFile, setConvozenFile] = useState<File | null>(null);

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
      ) : mode === "batch" && convozenFile ? (
        <div className="space-y-4">
          <div className="rounded-2xl border border-violet-200 bg-violet-50 text-violet-800 text-sm px-5 py-3">
            This is a Convozen export, so Otis will audit it from its transcript / summary text.{" "}
            <button
              type="button"
              onClick={() => {
                setConvozenFile(null);
                setSpreadsheet(null);
              }}
              className="font-semibold underline"
            >
              Choose a different file
            </button>
          </div>
          <ConvozenBatchUpload
            key={convozenFile.name + convozenFile.lastModified}
            agents={agents}
            initialFile={convozenFile}
            defaultAgentId={defaultAgentId}
          />
        </div>
      ) : mode === "batch" ? (
        <BatchForm
          key={spreadsheet ? spreadsheet.name + spreadsheet.lastModified : "empty"}
          agents={agents}
          defaultAgentId={defaultAgentId}
          initialFile={spreadsheet}
          onConvozen={setConvozenFile}
        />
      ) : (
        <UploadForm
          agents={agents}
          defaultAgentId={defaultAgentId}
          onSpreadsheet={(f) => {
            setConvozenFile(null);
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
