-- ============================================================
-- Migration 010: Quote Intelligence Engine V1.1 — P0
--
-- A DECISION-SUPPORT layer, not an auto-quoting system. It recommends a
-- margin ladder + negotiation guardrails + a sample policy for each deal.
-- Every output is a *recommendation*; nothing is auto-sent to a customer.
--
-- Additive only — does NOT touch existing data. Safe to re-run
-- (IF NOT EXISTS everywhere, DO blocks for policies, ON CONFLICT for seed).
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- 1. PRICING_CONFIG — per-category cost + margin baselines (hand-filled)
--    Four-margin ladder:  strategic ≤ floor ≤ recommended ≤ target
--    base_cost_index is a per-unit baseline cost (USD). Owner edits to real cost.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pricing_config (
  category           TEXT PRIMARY KEY,          -- leggings|sports_bra|jacket|hoodie|shorts|activewear_set
  label              TEXT,                       -- human label (zh)
  base_cost_index    NUMERIC NOT NULL,           -- per-unit baseline cost (USD or index)
  complexity_factor  NUMERIC NOT NULL DEFAULT 1, -- fabric/process complexity multiplier
  dev_cost           NUMERIC NOT NULL DEFAULT 0, -- one-time sampling/pattern cost (USD), amortized over qty
  moq                INT     NOT NULL DEFAULT 50,
  target_margin      NUMERIC NOT NULL,           -- 0-1, anchor "good outcome" margin
  recommended_margin NUMERIC NOT NULL,           -- 0-1, default recommended starting point
  floor_margin       NUMERIC NOT NULL,           -- 0-1, HARD red line for normal customers
  strategic_margin   NUMERIC NOT NULL,           -- 0-1, absolute red line, strategic + owner-approval only
  needs_real_cost    BOOLEAN NOT NULL DEFAULT TRUE, -- true = seed baseline, owner must confirm real cost
  updated_at         TIMESTAMPTZ DEFAULT NOW()
);

-- Seed the 5–6 apparel categories with sensible OEM baselines.
-- These are STARTING baselines flagged needs_real_cost=true — owner must verify
-- real cost before trusting the margins (avoids "garbage in, garbage out").
INSERT INTO pricing_config
  (category, label, base_cost_index, complexity_factor, dev_cost, moq, target_margin, recommended_margin, floor_margin, strategic_margin)
VALUES
  ('leggings',       'Leggings 瑜伽裤',  4.20, 1.00,  80, 50, 0.30, 0.24, 0.16, 0.08),
  ('sports_bra',     'Sports Bra 运动内衣', 3.00, 1.10,  90, 50, 0.32, 0.26, 0.17, 0.09),
  ('jacket',         'Jacket 外套',      11.00, 1.30, 150, 50, 0.28, 0.22, 0.15, 0.07),
  ('hoodie',         'Hoodie 卫衣',       7.50, 1.10, 100, 50, 0.30, 0.24, 0.16, 0.08),
  ('shorts',         'Shorts 短裤',       3.80, 0.90,  70, 50, 0.28, 0.22, 0.15, 0.07),
  ('activewear_set', 'Activewear Set 运动套装', 9.00, 1.20, 160, 50, 0.31, 0.25, 0.17, 0.09)
ON CONFLICT (category) DO NOTHING;

-- ─────────────────────────────────────────────────────────────
-- 2. QUOTE_STRATEGIES — one snapshot per generated recommendation
--    (re-computable, auditable; never an auto-quote)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS quote_strategies (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            UUID REFERENCES companies(id) ON DELETE CASCADE,
  category              TEXT,
  qty                   INT,
  fabric_complexity     TEXT,                 -- low|medium|high

  -- ① five scores (0-100, rule-based, explainable)
  pricing_score         INT,
  deal_value_score      INT,
  win_probability       INT,
  risk_score            INT,
  strategic_value_score INT,

  -- ② four-margin ladder (0-1)
  floor_margin          NUMERIC,
  recommended_margin    NUMERIC,
  target_margin         NUMERIC,
  strategic_margin      NUMERIC,
  recommended_price     NUMERIC,              -- per-unit, derived from recommended_margin

  -- ③ gating + policy (recommendation only — never auto-executes)
  requires_owner_approval BOOLEAN DEFAULT FALSE, -- strategic (sub-floor) band unlocked → owner must approve
  sample_policy         TEXT,                 -- free|partial|full
  negotiation_rules     JSONB,                -- {allow:[],forbid:[],warnings:[]}
  explanation           JSONB,                -- {margin,concession,sample,overall}
  inputs_snapshot       JSONB,                -- customer signals at compute time (for replay)
  cac                   JSONB,                -- RESERVED (P1/P2): acquisition cost — not computed in P0
  approval_id           UUID REFERENCES approvals(id) ON DELETE SET NULL,

  created_by            TEXT,
  created_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_quote_strategies_company ON quote_strategies(company_id, created_at DESC);

-- ─────────────────────────────────────────────────────────────
-- 3. COMPANIES — two optional salesperson-annotated columns (nullable)
-- ─────────────────────────────────────────────────────────────
ALTER TABLE companies ADD COLUMN IF NOT EXISTS is_price_comparing BOOLEAN;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS competition_level  TEXT; -- extreme|strong|normal|weak

-- ─────────────────────────────────────────────────────────────
-- 4. ACQUISITION_COSTS — RESERVED schema only (P1 wiring, P2 calculation).
--    P0 does NOT read or write this table; it exists so LTV − CAC can land later.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS acquisition_costs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID REFERENCES companies(id) ON DELETE CASCADE,
  type        TEXT,                 -- email|call|sample|travel|labor
  amount      NUMERIC,
  hours       NUMERIC,
  note        TEXT,
  occurred_at TIMESTAMPTZ DEFAULT NOW(),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_acquisition_costs_company ON acquisition_costs(company_id);

-- ─────────────────────────────────────────────────────────────
-- 5. RLS
-- ─────────────────────────────────────────────────────────────
ALTER TABLE pricing_config    ENABLE ROW LEVEL SECURITY;
ALTER TABLE quote_strategies  ENABLE ROW LEVEL SECURITY;
ALTER TABLE acquisition_costs ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'pricing_config'    AND policyname = 'authenticated_all') THEN
    EXECUTE 'CREATE POLICY authenticated_all ON pricing_config    FOR ALL TO authenticated USING (true)'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'quote_strategies'  AND policyname = 'authenticated_all') THEN
    EXECUTE 'CREATE POLICY authenticated_all ON quote_strategies  FOR ALL TO authenticated USING (true)'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'acquisition_costs' AND policyname = 'authenticated_all') THEN
    EXECUTE 'CREATE POLICY authenticated_all ON acquisition_costs FOR ALL TO authenticated USING (true)'; END IF;
END $$;

-- ─────────────────────────────────────────────────────────────
-- VERIFY — all values should be ≥ 1 (6 = seeded categories)
-- ─────────────────────────────────────────────────────────────
SELECT
  (SELECT count(*) FROM information_schema.tables  WHERE table_name = 'pricing_config')    AS t_pricing_config,
  (SELECT count(*) FROM pricing_config)                                                     AS n_categories,
  (SELECT count(*) FROM information_schema.tables  WHERE table_name = 'quote_strategies')   AS t_quote_strategies,
  (SELECT count(*) FROM information_schema.tables  WHERE table_name = 'acquisition_costs')  AS t_acquisition_costs,
  (SELECT count(*) FROM information_schema.columns WHERE table_name = 'companies' AND column_name = 'is_price_comparing') AS c_co_price_comparing,
  (SELECT count(*) FROM information_schema.columns WHERE table_name = 'companies' AND column_name = 'competition_level')  AS c_co_competition;
