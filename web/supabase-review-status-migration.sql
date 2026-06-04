-- Manual review state for each audit: reviewers mark a recording's audit
-- report as reviewed / flagged; anything untouched stays 'not_reviewed'.
-- Run once in Supabase → SQL Editor. Idempotent.

ALTER TABLE audits
  ADD COLUMN IF NOT EXISTS review_status TEXT NOT NULL DEFAULT 'not_reviewed';

CREATE INDEX IF NOT EXISTS idx_audits_review_status
  ON audits(review_status);
