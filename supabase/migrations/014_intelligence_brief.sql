-- Migration 014: Customer Intelligence Brief (cached decision brief)
-- Apply manually in the Supabase SQL editor (idempotent).
--
-- The brief is computed by the PURE inference layer (lib/intel/*) from existing
-- data and rendered live on the report page; this column caches the latest brief
-- (e.g. for the company-page top card / list views). No other schema change.

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS intelligence_brief    JSONB,
  ADD COLUMN IF NOT EXISTS intelligence_brief_at TIMESTAMPTZ;

-- ── VERIFY — both should be 1 ──────────────────────────────────────────────────
SELECT
  (SELECT count(*) FROM information_schema.columns WHERE table_name = 'companies' AND column_name = 'intelligence_brief')    AS has_brief,
  (SELECT count(*) FROM information_schema.columns WHERE table_name = 'companies' AND column_name = 'intelligence_brief_at') AS has_brief_at;
