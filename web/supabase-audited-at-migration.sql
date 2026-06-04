-- When an audit finished scoring (distinct from `timestamp`, the upload time).
-- Run once in Supabase → SQL Editor. Idempotent.
--
-- New audits set this automatically on finalize. Existing rows stay NULL;
-- the dashboard/export fall back to the upload timestamp for those.

ALTER TABLE audits
  ADD COLUMN IF NOT EXISTS audited_at TEXT;
