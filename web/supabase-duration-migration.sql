-- Call-recording duration, in seconds, per audit.
-- Powers the dashboard duration filter. Run once in Supabase → SQL Editor.
-- Idempotent: safe to run twice.

ALTER TABLE audits
  ADD COLUMN IF NOT EXISTS duration_seconds INTEGER;

CREATE INDEX IF NOT EXISTS idx_audits_duration ON audits(duration_seconds);

-- New audits fill this in automatically when they finish scoring
-- (from AssemblyAI's audio_duration). Existing rows are backfilled by
-- hitting POST /api/admin/backfill-duration after deploy.
