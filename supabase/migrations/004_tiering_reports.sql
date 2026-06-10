-- ============================================================
-- Migration 004: Customer Tiering & Intelligence Reports
--
-- customer_tier is DISTINCT from `grade` (generic ICP fit):
--   tier factors business feasibility — compliance, conversion, strategy.
--   A = strategic / long-cycle (not necessarily chase-now)
--   B = best short-term development target
--   C = quick test / cash flow
--   D = reject / deprioritize
--
-- Safe to re-run (IF NOT EXISTS everywhere).
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- 1. COMPANIES — tiering & development strategy fields
-- ─────────────────────────────────────────────────────────────
ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS customer_tier                  TEXT,    -- A | B | C | D
  ADD COLUMN IF NOT EXISTS tier_reasoning                 TEXT,
  ADD COLUMN IF NOT EXISTS compliance_level               TEXT,    -- none | basic_docs | bsci_wrap | sedex_smeta | oeko_grs | customer_audit | supplier_portal
  ADD COLUMN IF NOT EXISTS compliance_requirements        JSONB,   -- ["BSCI","SMETA",...]
  ADD COLUMN IF NOT EXISTS compliance_blockers            JSONB,   -- ["needs SMETA partner factory",...]
  ADD COLUMN IF NOT EXISTS conversion_feasibility_score   NUMERIC, -- 0-10, higher = easier to convert now
  ADD COLUMN IF NOT EXISTS strategic_value_score          NUMERIC, -- 0-10
  ADD COLUMN IF NOT EXISTS customer_scale_score           NUMERIC, -- 0-10
  ADD COLUMN IF NOT EXISTS product_match_score            NUMERIC, -- 0-10
  ADD COLUMN IF NOT EXISTS product_match                  JSONB,   -- [{category,level,suggested_sku,reason}]
  ADD COLUMN IF NOT EXISTS payment_risk_score             NUMERIC, -- 0-10, higher = riskier
  ADD COLUMN IF NOT EXISTS recommended_development_strategy TEXT,
  ADD COLUMN IF NOT EXISTS recommended_factory_type       TEXT,    -- current | current_after_renewal | partner_smeta | partner_or_current | unknown
  ADD COLUMN IF NOT EXISTS target_customer_segment        TEXT,
  ADD COLUMN IF NOT EXISTS next_action                    TEXT,
  ADD COLUMN IF NOT EXISTS tiered_at                      TIMESTAMPTZ;

-- ─────────────────────────────────────────────────────────────
-- 2. CUSTOMER INTELLIGENCE REPORTS
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS customer_intelligence_reports (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id                UUID REFERENCES companies(id) ON DELETE CASCADE,
  report_version            INT  DEFAULT 1,
  report_depth              TEXT DEFAULT 'standard',  -- short | standard | deep
  customer_tier             TEXT,
  executive_summary         JSONB,
  company_profile           JSONB,
  business_model            JSONB,
  product_lines             JSONB,
  product_match             JSONB,
  compliance_requirements   JSONB,
  supplier_entry_path       JSONB,
  contact_strategy          JSONB,
  outreach_angles           JSONB,
  risk_assessment           JSONB,
  recommended_actions       JSONB,
  draft_messages            JSONB,
  source_urls               JSONB,
  confidence_score          NUMERIC,
  created_by                TEXT DEFAULT 'ai',
  created_at                TIMESTAMPTZ DEFAULT NOW(),
  updated_at                TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────
-- 3. INDEXES
-- ─────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_companies_tier            ON companies(customer_tier) WHERE customer_tier IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_companies_compliance       ON companies(compliance_level) WHERE compliance_level IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_companies_factory_type      ON companies(recommended_factory_type) WHERE recommended_factory_type IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_reports_company             ON customer_intelligence_reports(company_id);
CREATE INDEX IF NOT EXISTS idx_reports_latest              ON customer_intelligence_reports(company_id, report_version DESC);

-- ─────────────────────────────────────────────────────────────
-- 4. RLS
-- ─────────────────────────────────────────────────────────────
ALTER TABLE customer_intelligence_reports ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'customer_intelligence_reports' AND policyname = 'authenticated_all') THEN
    EXECUTE 'CREATE POLICY authenticated_all ON customer_intelligence_reports FOR ALL TO authenticated USING (true)';
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────
-- VERIFY — all values should be 1
-- ─────────────────────────────────────────────────────────────
SELECT
  (SELECT count(*) FROM information_schema.columns WHERE table_name = 'companies' AND column_name = 'customer_tier')                AS c_tier,
  (SELECT count(*) FROM information_schema.columns WHERE table_name = 'companies' AND column_name = 'compliance_level')             AS c_compliance,
  (SELECT count(*) FROM information_schema.columns WHERE table_name = 'companies' AND column_name = 'conversion_feasibility_score') AS c_conv,
  (SELECT count(*) FROM information_schema.columns WHERE table_name = 'companies' AND column_name = 'recommended_factory_type')     AS c_factory,
  (SELECT count(*) FROM information_schema.columns WHERE table_name = 'companies' AND column_name = 'next_action')                  AS c_next,
  (SELECT count(*) FROM information_schema.tables  WHERE table_name = 'customer_intelligence_reports')                              AS t_reports;
-- All values should be 1.
