-- Per-agent scoring rubric: the list of dimensions and each one's min/max
-- score range, as JSON. NULL means "use the built-in default 10 dimensions".
-- Run once in Supabase → SQL Editor. Idempotent.

ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS rubric_json TEXT;
