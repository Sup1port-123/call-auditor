-- Auto-ingestion support. Run once in Supabase → SQL Editor. Idempotent.

-- Dedup key: the source platform's unique call id. NULL for manually-added
-- audits. A unique index stops the same call being ingested twice (Postgres
-- treats NULLs as distinct, so manual audits are unaffected).
ALTER TABLE audits
  ADD COLUMN IF NOT EXISTS external_call_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_audits_external_call_id
  ON audits(external_call_id);

-- Map a source-platform agent identifier (or several, comma-separated) to this
-- Otis agent, so ingested calls auto-route to the right rubric + knowledge base.
ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS external_keys TEXT;
