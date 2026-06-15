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
  updated_at              TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT app_config_singleton CHECK (id = 'singleton')
);

INSERT INTO app_config (id) VALUES ('singleton') ON CONFLICT (id) DO NOTHING;

ALTER TABLE app_config ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'app_config' AND policyname = 'authenticated_all') THEN
    EXECUTE 'CREATE POLICY authenticated_all ON app_config FOR ALL TO authenticated USING (true)';
  END IF;
END $$;

SELECT (SELECT count(*) FROM information_schema.tables WHERE table_name = 'app_config') AS t_app_config;
