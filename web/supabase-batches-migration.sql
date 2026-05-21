-- Batch auditing: upload a spreadsheet of recording URLs.
-- Run once in Supabase -> SQL Editor. Idempotent.

CREATE TABLE IF NOT EXISTS batches (
    id            TEXT PRIMARY KEY,
    label         TEXT,
    agent_id      TEXT,
    preset        TEXT,
    strictness    TEXT,
    custom_focus  TEXT,
    url_column    TEXT,
    total         INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_batches_created ON batches(created_at DESC);

ALTER TABLE audits ADD COLUMN IF NOT EXISTS batch_id TEXT;
CREATE INDEX IF NOT EXISTS idx_audits_batch ON audits(batch_id);

-- Match the rest of the app: no row-level security (public, no auth).
-- This avoids the "insert works but reads 404" trap.
ALTER TABLE batches DISABLE ROW LEVEL SECURITY;

-- audits.status now also takes 'queued' (a batch row awaiting submission).
