-- Settings for the automated daily email report. Single row (id = 'default').
-- Run once in Supabase → SQL Editor. Idempotent.

CREATE TABLE IF NOT EXISTS report_settings (
    id              TEXT PRIMARY KEY DEFAULT 'default',
    emails          TEXT,            -- comma-separated recipients
    send_time       TEXT,            -- "HH:MM" in the timezone below
    timezone        TEXT NOT NULL DEFAULT 'IST',
    enabled         BOOLEAN NOT NULL DEFAULT false,
    last_sent_date  TEXT,            -- "YYYY-MM-DD" (IST) the report last went out
    updated_at      TEXT
);

ALTER TABLE report_settings DISABLE ROW LEVEL SECURITY;

INSERT INTO report_settings (id, enabled, timezone)
VALUES ('default', false, 'IST')
ON CONFLICT (id) DO NOTHING;
