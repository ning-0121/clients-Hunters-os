-- ============================================================
-- Migration 012: fix lead assignment — companies.assigned_to → TEXT (email)
--
-- companies.assigned_to was UUID (migration 001), but the whole design uses the
-- LOGIN EMAIL as the assignment identity:
--   - tasks.assigned_to / conversations.assigned_to are TEXT (email/name)
--   - user_email_settings.owner = "login email (matches assigned_to)"
--   - the salesperson roster (app_config.salespeople) holds emails/names
--   - send-email-agent looks up the sender mailbox by assigned_to = owner email
-- Migration 003 INTENDED TEXT (`ADD COLUMN IF NOT EXISTS assigned_to TEXT`) but it
-- was a no-op because the UUID column already existed. This converts it for real.
-- All values are currently NULL, so the cast is clean.
--
-- Idempotent: only alters when the column is still uuid. Safe to re-run.
-- ============================================================

DO $$
BEGIN
  IF (SELECT data_type FROM information_schema.columns
      WHERE table_name = 'companies' AND column_name = 'assigned_to') = 'uuid' THEN
    ALTER TABLE companies ALTER COLUMN assigned_to TYPE TEXT USING assigned_to::text;
  END IF;
END $$;

-- Speeds up "我的客户" (assigned_to = me) lookups.
CREATE INDEX IF NOT EXISTS idx_companies_assigned ON companies(assigned_to) WHERE assigned_to IS NOT NULL;

-- VERIFY — should print 'text'
SELECT data_type AS companies_assigned_to_type
FROM information_schema.columns
WHERE table_name = 'companies' AND column_name = 'assigned_to';
