-- ============================================================
-- Migration 008: per-user sending-email binding
-- Each salesperson binds their OWN mailbox so outreach is sent from them.
-- owner = the login identity stored in companies.assigned_to (email).
-- Safe to re-run.
-- ============================================================

CREATE TABLE IF NOT EXISTS user_email_settings (
  owner         TEXT PRIMARY KEY,        -- login email (matches assigned_to)
  from_name     TEXT,
  sender_email  TEXT NOT NULL,
  smtp_host     TEXT,                    -- null → treat sender as @gmail.com app-password
  smtp_port     INT  DEFAULT 465,
  app_password  TEXT NOT NULL,           -- SMTP / Gmail app password
  active        BOOLEAN DEFAULT true,
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE user_email_settings ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'user_email_settings' AND policyname = 'authenticated_all') THEN
    EXECUTE 'CREATE POLICY authenticated_all ON user_email_settings FOR ALL TO authenticated USING (true)';
  END IF;
END $$;

SELECT (SELECT count(*) FROM information_schema.tables WHERE table_name = 'user_email_settings') AS t_user_email_settings;
