-- ============================================================
-- Migration 006: app_config — singleton settings row
-- Drives the "auto-discovery" (每日自动获客) feature, editable in /settings.
-- Safe to re-run.
-- ============================================================

CREATE TABLE IF NOT EXISTS app_config (
  id                      TEXT PRIMARY KEY DEFAULT 'singleton',
  auto_discovery_enabled  BOOLEAN DEFAULT false,
  daily_quota             INT DEFAULT 20,
  segments                JSONB DEFAULT '["overseas","domestic","recruitment"]'::jsonb,
  sales_focus             TEXT DEFAULT 'activewear',  -- activewear | activewear_first | software
  salespeople             JSONB DEFAULT '[]'::jsonb,
  assign_quota            JSONB DEFAULT '{"A":5,"B":10,"C":15}'::jsonb,
  last_assignment         JSONB,
  onboarding_completed    BOOLEAN DEFAULT false,
  seller_profile          JSONB,
  updated_at              TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT app_config_singleton CHECK (id = 'singleton')
);

-- For tables created before sales_focus existed:
ALTER TABLE app_config ADD COLUMN IF NOT EXISTS sales_focus TEXT DEFAULT 'activewear';
-- Salesperson roster + per-person assignment quota (5A/10B/15C):
ALTER TABLE app_config ADD COLUMN IF NOT EXISTS salespeople JSONB DEFAULT '[]'::jsonb;
ALTER TABLE app_config ADD COLUMN IF NOT EXISTS assign_quota JSONB DEFAULT '{"A":5,"B":10,"C":15}'::jsonb;
ALTER TABLE app_config ADD COLUMN IF NOT EXISTS last_assignment JSONB;
-- First-login onboarding: seller/company profile that shapes outreach.
ALTER TABLE app_config ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN DEFAULT false;
ALTER TABLE app_config ADD COLUMN IF NOT EXISTS seller_profile JSONB;

INSERT INTO app_config (id) VALUES ('singleton') ON CONFLICT (id) DO NOTHING;

ALTER TABLE app_config ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'app_config' AND policyname = 'authenticated_all') THEN
    EXECUTE 'CREATE POLICY authenticated_all ON app_config FOR ALL TO authenticated USING (true)';
  END IF;
END $$;

SELECT (SELECT count(*) FROM information_schema.tables WHERE table_name = 'app_config') AS t_app_config;
