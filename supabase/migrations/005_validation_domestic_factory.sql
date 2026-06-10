-- ============================================================
-- Migration 005: Report QA · Domestic Segment · Factory Matrix
--
--   1. report_quality_reviews — manual evaluation of reports
--   2. companies — domestic trading-company segment fields
--   3. customer_intelligence_reports — report_kind + domestic_report
--   4. factory_profiles / factory_certifications / factory_capabilities
--   5. seed QIMO own factory (BSCI/WRAP expired) + one SMETA partner factory
--
-- Safe to re-run (IF NOT EXISTS everywhere; seed is idempotent).
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- 1. REPORT QUALITY REVIEWS
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS report_quality_reviews (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id                  UUID REFERENCES companies(id) ON DELETE CASCADE,
  report_id                   UUID REFERENCES customer_intelligence_reports(id) ON DELETE CASCADE,
  reviewer                    TEXT,
  overall_score               INT,   -- 1-10
  accuracy_score              INT,
  usefulness_score            INT,
  compliance_accuracy_score   INT,
  product_match_score         INT,
  next_action_quality_score   INT,
  notes                       TEXT,
  created_at                  TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────
-- 2. COMPANIES — domestic Chinese trading-company segment
--    (target_customer_segment already added in migration 004)
-- ─────────────────────────────────────────────────────────────
ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS domestic_company_type             TEXT,    -- apparel_trading_company | activewear_trading_company | general_import_export_company | cross_border_ecommerce_seller | sourcing_agent | factory_with_export_department | software_prospect
  ADD COLUMN IF NOT EXISTS development_purpose               TEXT,    -- order_cooperation | software_sales | channel_partnership | supplier_partnership | unknown
  ADD COLUMN IF NOT EXISTS order_partner_potential_score     NUMERIC, -- 0-10
  ADD COLUMN IF NOT EXISTS software_customer_potential_score NUMERIC, -- 0-10
  ADD COLUMN IF NOT EXISTS management_pain_signals           JSONB,
  ADD COLUMN IF NOT EXISTS recruitment_signals               JSONB,
  ADD COLUMN IF NOT EXISTS domestic_region                   TEXT,    -- 义乌 | 杭州 | 宁波 | 广州 | 深圳 | 上海 | ...
  ADD COLUMN IF NOT EXISTS recommended_domestic_strategy     TEXT,
  ADD COLUMN IF NOT EXISTS recommended_factory_id            UUID;

-- ─────────────────────────────────────────────────────────────
-- 3. REPORTS — kind + domestic-style payload
-- ─────────────────────────────────────────────────────────────
ALTER TABLE customer_intelligence_reports
  ADD COLUMN IF NOT EXISTS report_kind     TEXT DEFAULT 'overseas',  -- overseas | domestic
  ADD COLUMN IF NOT EXISTS domestic_report JSONB;

-- ─────────────────────────────────────────────────────────────
-- 4. FACTORY CAPABILITY MATRIX
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS factory_profiles (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name              TEXT NOT NULL,
  location          TEXT,
  factory_type      TEXT,    -- own_factory | partner_factory
  main_categories   JSONB,   -- ["activewear","seamless",...]
  monthly_capacity  TEXT,
  moq_range         TEXT,
  price_level       TEXT,    -- low | medium | high
  cooperation_status TEXT,
  notes             TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS factory_certifications (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id          UUID REFERENCES factory_profiles(id) ON DELETE CASCADE,
  certification_type  TEXT,  -- BSCI | WRAP | SMETA | Sedex | OEKO | GRS | ISO9001 | other
  status              TEXT,  -- valid | expired | in_renewal | planned | unknown
  expiry_date         DATE,
  document_url        TEXT,
  notes               TEXT
);

CREATE TABLE IF NOT EXISTS factory_capabilities (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id              UUID REFERENCES factory_profiles(id) ON DELETE CASCADE,
  category                TEXT,
  capability_level        TEXT,  -- strong | medium | weak
  suitable_customer_tiers JSONB, -- ["A","B"]
  suitable_regions        JSONB, -- ["EU","UK","LATAM"]
  risk_notes              TEXT
);

-- ─────────────────────────────────────────────────────────────
-- 5. INDEXES
-- ─────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_companies_segment      ON companies(target_customer_segment) WHERE target_customer_segment IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_companies_dom_type      ON companies(domestic_company_type) WHERE domestic_company_type IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_reviews_company         ON report_quality_reviews(company_id);
CREATE INDEX IF NOT EXISTS idx_reviews_report          ON report_quality_reviews(report_id);
CREATE INDEX IF NOT EXISTS idx_factory_certs_factory   ON factory_certifications(factory_id);
CREATE INDEX IF NOT EXISTS idx_factory_caps_factory    ON factory_capabilities(factory_id);

-- ─────────────────────────────────────────────────────────────
-- 6. RLS
-- ─────────────────────────────────────────────────────────────
ALTER TABLE report_quality_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE factory_profiles       ENABLE ROW LEVEL SECURITY;
ALTER TABLE factory_certifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE factory_capabilities   ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['report_quality_reviews','factory_profiles','factory_certifications','factory_capabilities'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = t AND policyname = 'authenticated_all') THEN
      EXECUTE format('CREATE POLICY authenticated_all ON %I FOR ALL TO authenticated USING (true)', t);
    END IF;
  END LOOP;
END $$;

-- ─────────────────────────────────────────────────────────────
-- 7. SEED — own factory (certs expired) + SMETA partner factory
-- ─────────────────────────────────────────────────────────────
DO $$
DECLARE
  own_id     UUID;
  partner_id UUID;
BEGIN
  -- Own factory
  SELECT id INTO own_id FROM factory_profiles WHERE factory_type = 'own_factory' LIMIT 1;
  IF own_id IS NULL THEN
    INSERT INTO factory_profiles (name, location, factory_type, main_categories, monthly_capacity, moq_range, price_level, cooperation_status, notes)
    VALUES ('QIMO / Jojofashion 自有工厂', 'China', 'own_factory',
            '["activewear","yoga","leggings","sports_bra","seamless","fleece","lounge"]'::jsonb,
            '~80,000 pcs', '50-300 pcs', 'medium', 'active',
            'Core activewear factory. BSCI/WRAP recently expired — renewal in progress.')
    RETURNING id INTO own_id;

    INSERT INTO factory_certifications (factory_id, certification_type, status, notes) VALUES
      (own_id, 'BSCI',  'expired',    'Recently expired — renewal planned'),
      (own_id, 'WRAP',  'expired',    'Recently expired — renewal planned'),
      (own_id, 'OEKO',  'valid',      'OEKO-TEX maintained'),
      (own_id, 'ISO9001','in_renewal','QMS renewal underway');

    INSERT INTO factory_capabilities (factory_id, category, capability_level, suitable_customer_tiers, suitable_regions, risk_notes) VALUES
      (own_id, 'seamless',   'strong', '["B","C"]'::jsonb, '["US","LATAM","EU"]'::jsonb, 'BSCI/WRAP expired — not for strict-compliance A buyers until renewed'),
      (own_id, 'leggings',   'strong', '["B","C"]'::jsonb, '["US","LATAM","EU"]'::jsonb, NULL),
      (own_id, 'sports_bra', 'strong', '["B","C"]'::jsonb, '["US","LATAM"]'::jsonb, NULL),
      (own_id, 'yoga',       'strong', '["B","C"]'::jsonb, '["US","EU"]'::jsonb, NULL),
      (own_id, 'fleece',     'medium', '["B","C"]'::jsonb, '["US"]'::jsonb, 'Seasonal capacity');
  END IF;

  -- Partner factory with valid audits
  SELECT id INTO partner_id FROM factory_profiles WHERE factory_type = 'partner_factory' LIMIT 1;
  IF partner_id IS NULL THEN
    INSERT INTO factory_profiles (name, location, factory_type, main_categories, monthly_capacity, moq_range, price_level, cooperation_status, notes)
    VALUES ('Audited Partner Factory A', 'China', 'partner_factory',
            '["activewear","seamless","leggings","sports_bra"]'::jsonb,
            '~120,000 pcs', '300-1000 pcs', 'medium', 'partner',
            'SMETA/Sedex/BSCI-valid partner for strict-compliance A-tier buyers.')
    RETURNING id INTO partner_id;

    INSERT INTO factory_certifications (factory_id, certification_type, status, notes) VALUES
      (partner_id, 'SMETA',  'valid', '4-pillar'),
      (partner_id, 'Sedex',  'valid', NULL),
      (partner_id, 'BSCI',   'valid', NULL),
      (partner_id, 'WRAP',   'valid', NULL),
      (partner_id, 'ISO9001','valid', NULL),
      (partner_id, 'GRS',    'valid', 'For recycled programs');

    INSERT INTO factory_capabilities (factory_id, category, capability_level, suitable_customer_tiers, suitable_regions, risk_notes) VALUES
      (partner_id, 'seamless',   'strong', '["A","B"]'::jsonb, '["EU","UK","Brazil","Italy"]'::jsonb, 'Higher MOQ'),
      (partner_id, 'leggings',   'strong', '["A","B"]'::jsonb, '["EU","UK","Brazil","Italy"]'::jsonb, NULL),
      (partner_id, 'sports_bra', 'medium', '["A","B"]'::jsonb, '["EU","UK"]'::jsonb, NULL);
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────
-- VERIFY — all values should be >= 1
-- ─────────────────────────────────────────────────────────────
SELECT
  (SELECT count(*) FROM information_schema.tables  WHERE table_name = 'report_quality_reviews')                       AS t_reviews,
  (SELECT count(*) FROM information_schema.columns WHERE table_name = 'companies' AND column_name = 'domestic_company_type') AS c_dom_type,
  (SELECT count(*) FROM information_schema.columns WHERE table_name = 'customer_intelligence_reports' AND column_name = 'report_kind') AS c_kind,
  (SELECT count(*) FROM information_schema.tables  WHERE table_name = 'factory_profiles')                             AS t_factories,
  (SELECT count(*) FROM factory_profiles)                                                                            AS n_factories;
