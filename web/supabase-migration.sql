-- Run this once in Supabase → SQL Editor → New query.
-- It's idempotent: safe to run twice, won't touch existing rows that already
-- have these columns.

ALTER TABLE audits
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'completed';

ALTER TABLE audits
  ADD COLUMN IF NOT EXISTS transcript_id TEXT;

ALTER TABLE audits
  ADD COLUMN IF NOT EXISTS error_message TEXT;

CREATE INDEX IF NOT EXISTS idx_audits_status ON audits(status);
CREATE INDEX IF NOT EXISTS idx_audits_transcript_id ON audits(transcript_id);

-- Status values used by the app:
--   'transcribing'  — submitted to AssemblyAI, awaiting webhook
--   'scoring'       — transcription done, running LLM
--   'completed'     — fully scored
--   'failed'        — see error_message column
