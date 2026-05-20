-- Run once in Supabase → SQL Editor. Idempotent.

CREATE TABLE IF NOT EXISTS agents (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    target          TEXT,
    description     TEXT,
    knowledge_base  TEXT,
    created_at      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_agents_created ON agents(created_at DESC);

-- Link audits to an agent (nullable — agent-less audits stay valid).
ALTER TABLE audits
  ADD COLUMN IF NOT EXISTS agent_id TEXT;

CREATE INDEX IF NOT EXISTS idx_audits_agent ON audits(agent_id);
