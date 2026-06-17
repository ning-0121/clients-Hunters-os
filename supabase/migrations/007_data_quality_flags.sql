-- ============================================================
-- Migration 007: data-quality flags on companies
-- Lets a salesperson report bad customer info / contact details so the system
-- can self-correct (re-enrich). Safe to re-run.
-- ============================================================

ALTER TABLE companies ADD COLUMN IF NOT EXISTS data_flag       TEXT;          -- 'bad_info' | 'bad_contact'
ALTER TABLE companies ADD COLUMN IF NOT EXISTS data_flag_note  TEXT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS data_flag_by    TEXT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS data_flag_at    TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_companies_data_flag ON companies(data_flag) WHERE data_flag IS NOT NULL;

SELECT (SELECT count(*) FROM information_schema.columns
        WHERE table_name = 'companies' AND column_name = 'data_flag') AS companies_data_flag;
