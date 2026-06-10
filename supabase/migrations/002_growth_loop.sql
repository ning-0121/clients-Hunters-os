-- ============================================================
-- Migration 002: Growth Loop Tables
-- Reply Tracking · Follow-up Sequences · Conversations
-- Worker Observability · Technographics · Triggers
--
-- Safe to re-run (IF NOT EXISTS everywhere, DO blocks for constraints)
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- 1. ADD MISSING COLUMNS TO EXISTING TABLES
-- ─────────────────────────────────────────────────────────────

ALTER TABLE outreach_logs
  ADD COLUMN IF NOT EXISTS gmail_message_id  TEXT,
  ADD COLUMN IF NOT EXISTS gmail_thread_id   TEXT,
  ADD COLUMN IF NOT EXISTS sent_at           TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS replied_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reply_content     TEXT,
  ADD COLUMN IF NOT EXISTS reply_sentiment   TEXT,
  ADD COLUMN IF NOT EXISTS reply_intent      TEXT;

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS klaviyo_detected        BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS recharg_detected        BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS triple_whale_detected   BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS gorgias_detected        BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS woocommerce_detected    BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS tech_stack              TEXT[],
  ADD COLUMN IF NOT EXISTS hiring_signal           BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS hiring_roles            TEXT[],
  ADD COLUMN IF NOT EXISTS hiring_signal_url       TEXT,
  ADD COLUMN IF NOT EXISTS trigger_type            TEXT,
  ADD COLUMN IF NOT EXISTS trigger_detail          TEXT,
  ADD COLUMN IF NOT EXISTS trigger_detected_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS new_products_detected   BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS funding_detected        BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS press_detected          BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS icp_confidence          FLOAT,
  ADD COLUMN IF NOT EXISTS enrichment_version      INT DEFAULT 1,
  ADD COLUMN IF NOT EXISTS conversation_id         UUID;

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS email_confidence    FLOAT,
  ADD COLUMN IF NOT EXISTS email_source        TEXT,
  ADD COLUMN IF NOT EXISTS email_pattern       TEXT,
  ADD COLUMN IF NOT EXISTS smtp_checked_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS hunter_confidence   INT,
  ADD COLUMN IF NOT EXISTS twitter_handle      TEXT;

ALTER TABLE customer_scores
  ADD COLUMN IF NOT EXISTS tech_stack_score        FLOAT,
  ADD COLUMN IF NOT EXISTS hiring_signal_score     FLOAT,
  ADD COLUMN IF NOT EXISTS trigger_score           FLOAT,
  ADD COLUMN IF NOT EXISTS contact_quality_score   FLOAT,
  ADD COLUMN IF NOT EXISTS market_timing_score     FLOAT;

ALTER TABLE agent_queue
  ADD COLUMN IF NOT EXISTS error_log     JSONB,
  ADD COLUMN IF NOT EXISTS completed_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS failed_at     TIMESTAMPTZ;

-- ─────────────────────────────────────────────────────────────
-- 2. CONVERSATIONS
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS conversations (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         UUID REFERENCES companies(id) ON DELETE CASCADE,
  contact_id         UUID REFERENCES contacts(id) ON DELETE SET NULL,
  first_outreach_id  UUID,
  status             TEXT DEFAULT 'active',
  thread_subject     TEXT,
  reply_count        INT DEFAULT 0,
  follow_up_count    INT DEFAULT 0,
  last_activity_at   TIMESTAMPTZ DEFAULT NOW(),
  last_sentiment     TEXT,
  last_intent        TEXT,
  meeting_booked     BOOLEAN DEFAULT FALSE,
  opportunity_value  NUMERIC(12,2),
  notes              TEXT,
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  updated_at         TIMESTAMPTZ DEFAULT NOW()
);

-- Add UNIQUE constraint if missing (table may exist without it)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'conversations'::regclass
      AND contype = 'u'
      AND conname = 'conversations_company_id_key'
  ) THEN
    ALTER TABLE conversations ADD CONSTRAINT conversations_company_id_key UNIQUE (company_id);
    RAISE NOTICE 'Added UNIQUE constraint on conversations.company_id';
  ELSE
    RAISE NOTICE 'conversations.company_id unique constraint already exists';
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────
-- 3. REPLY EVENTS
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reply_events (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  outreach_log_id    UUID REFERENCES outreach_logs(id) ON DELETE SET NULL,
  company_id         UUID REFERENCES companies(id) ON DELETE CASCADE,
  contact_id         UUID REFERENCES contacts(id) ON DELETE SET NULL,
  conversation_id    UUID REFERENCES conversations(id) ON DELETE SET NULL,
  gmail_message_id   TEXT,
  gmail_thread_id    TEXT,
  from_email         TEXT,
  reply_subject      TEXT,
  reply_body         TEXT,
  reply_sentiment    TEXT,
  reply_intent       TEXT,
  received_at        TIMESTAMPTZ DEFAULT NOW(),
  processed_at       TIMESTAMPTZ DEFAULT NOW(),
  created_at         TIMESTAMPTZ DEFAULT NOW()
);

-- Add UNIQUE constraint on gmail_message_id if missing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'reply_events'::regclass
      AND contype = 'u'
      AND conname = 'reply_events_gmail_message_id_key'
  ) THEN
    ALTER TABLE reply_events ADD CONSTRAINT reply_events_gmail_message_id_key UNIQUE (gmail_message_id);
    RAISE NOTICE 'Added UNIQUE constraint on reply_events.gmail_message_id';
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────
-- 4. FOLLOWUP RUNS
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS followup_runs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       UUID REFERENCES companies(id) ON DELETE CASCADE,
  contact_id       UUID REFERENCES contacts(id) ON DELETE SET NULL,
  conversation_id  UUID REFERENCES conversations(id) ON DELETE SET NULL,
  original_log_id  UUID REFERENCES outreach_logs(id) ON DELETE SET NULL,
  outreach_log_id  UUID REFERENCES outreach_logs(id) ON DELETE SET NULL,
  step             INT NOT NULL,
  status           TEXT DEFAULT 'scheduled',
  scheduled_for    TIMESTAMPTZ NOT NULL,
  sent_at          TIMESTAMPTZ,
  skipped_reason   TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────
-- 5. EMAIL SEND LOG
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS email_send_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  to_email    TEXT,
  company_id  UUID REFERENCES companies(id) ON DELETE SET NULL,
  log_id      UUID,
  method      TEXT DEFAULT 'gmail',
  sent_at     TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────
-- 6. WORKER HEARTBEATS
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS worker_heartbeats (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_id       TEXT NOT NULL,
  worker_type     TEXT,
  status          TEXT DEFAULT 'running',
  jobs_processed  INT DEFAULT 0,
  last_job_at     TIMESTAMPTZ,
  error_message   TEXT,
  metadata        JSONB,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Add UNIQUE constraint on worker_id if missing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'worker_heartbeats'::regclass
      AND contype = 'u'
      AND conname = 'worker_heartbeats_worker_id_key'
  ) THEN
    ALTER TABLE worker_heartbeats ADD CONSTRAINT worker_heartbeats_worker_id_key UNIQUE (worker_id);
    RAISE NOTICE 'Added UNIQUE constraint on worker_heartbeats.worker_id';
  ELSE
    RAISE NOTICE 'worker_heartbeats.worker_id unique constraint already exists';
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────
-- 7. JOB RUNS
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS job_runs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  queue_job_id    UUID REFERENCES agent_queue(id) ON DELETE SET NULL,
  worker_id       TEXT NOT NULL,
  job_type        TEXT NOT NULL,
  company_id      UUID REFERENCES companies(id) ON DELETE SET NULL,
  payload         JSONB,
  status          TEXT DEFAULT 'running',
  started_at      TIMESTAMPTZ DEFAULT NOW(),
  completed_at    TIMESTAMPTZ,
  duration_ms     INT,
  error_message   TEXT,
  output_data     JSONB,
  attempt_number  INT DEFAULT 1,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────
-- 8. TRIGGER EVENTS
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS trigger_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      UUID REFERENCES companies(id) ON DELETE CASCADE,
  trigger_type    TEXT NOT NULL,
  trigger_source  TEXT,
  detail          TEXT,
  url             TEXT,
  detected_at     TIMESTAMPTZ DEFAULT NOW(),
  processed       BOOLEAN DEFAULT FALSE
);

-- ─────────────────────────────────────────────────────────────
-- 9. INDEXES (all IF NOT EXISTS)
-- ─────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_reply_events_company   ON reply_events(company_id);
CREATE INDEX IF NOT EXISTS idx_reply_events_msg_id    ON reply_events(gmail_message_id);
CREATE INDEX IF NOT EXISTS idx_reply_events_received  ON reply_events(received_at DESC);
CREATE INDEX IF NOT EXISTS idx_followup_runs_due      ON followup_runs(scheduled_for) WHERE status = 'scheduled';
CREATE INDEX IF NOT EXISTS idx_followup_runs_company  ON followup_runs(company_id);
CREATE INDEX IF NOT EXISTS idx_email_send_log_date    ON email_send_log(sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_job_runs_type          ON job_runs(job_type, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_job_runs_worker        ON job_runs(worker_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversations_company  ON conversations(company_id);
CREATE INDEX IF NOT EXISTS idx_conversations_status   ON conversations(status);
CREATE INDEX IF NOT EXISTS idx_trigger_events_company ON trigger_events(company_id);
CREATE INDEX IF NOT EXISTS idx_outreach_gmail_msg_id  ON outreach_logs(gmail_message_id) WHERE gmail_message_id IS NOT NULL;

-- These indexes require the columns to exist first (added by ALTER TABLE above)
CREATE INDEX IF NOT EXISTS idx_companies_trigger_type ON companies(trigger_type) WHERE trigger_type IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_companies_hiring       ON companies(hiring_signal) WHERE hiring_signal = TRUE;

-- ─────────────────────────────────────────────────────────────
-- 10. RLS (safe to re-run)
-- ─────────────────────────────────────────────────────────────
ALTER TABLE conversations     ENABLE ROW LEVEL SECURITY;
ALTER TABLE reply_events      ENABLE ROW LEVEL SECURITY;
ALTER TABLE followup_runs     ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_send_log    ENABLE ROW LEVEL SECURITY;
ALTER TABLE worker_heartbeats ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_runs          ENABLE ROW LEVEL SECURITY;
ALTER TABLE trigger_events    ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'conversations'     AND policyname = 'authenticated_all') THEN
    EXECUTE 'CREATE POLICY authenticated_all ON conversations     FOR ALL TO authenticated USING (true)'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'reply_events'      AND policyname = 'authenticated_all') THEN
    EXECUTE 'CREATE POLICY authenticated_all ON reply_events      FOR ALL TO authenticated USING (true)'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'followup_runs'     AND policyname = 'authenticated_all') THEN
    EXECUTE 'CREATE POLICY authenticated_all ON followup_runs     FOR ALL TO authenticated USING (true)'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'email_send_log'    AND policyname = 'authenticated_all') THEN
    EXECUTE 'CREATE POLICY authenticated_all ON email_send_log    FOR ALL TO authenticated USING (true)'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'worker_heartbeats' AND policyname = 'authenticated_all') THEN
    EXECUTE 'CREATE POLICY authenticated_all ON worker_heartbeats FOR ALL TO authenticated USING (true)'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'job_runs'          AND policyname = 'authenticated_all') THEN
    EXECUTE 'CREATE POLICY authenticated_all ON job_runs          FOR ALL TO authenticated USING (true)'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'trigger_events'    AND policyname = 'authenticated_all') THEN
    EXECUTE 'CREATE POLICY authenticated_all ON trigger_events    FOR ALL TO authenticated USING (true)'; END IF;
END $$;

-- ─────────────────────────────────────────────────────────────
-- VERIFY: quick sanity check — these should all return 0 rows
-- if migration ran correctly
-- ─────────────────────────────────────────────────────────────
SELECT
  (SELECT count(*) FROM information_schema.columns
   WHERE table_name = 'companies' AND column_name = 'trigger_type')     AS companies_trigger_type,
  (SELECT count(*) FROM information_schema.columns
   WHERE table_name = 'companies' AND column_name = 'hiring_signal')    AS companies_hiring_signal,
  (SELECT count(*) FROM information_schema.columns
   WHERE table_name = 'contacts'  AND column_name = 'email_confidence') AS contacts_email_confidence,
  (SELECT count(*) FROM information_schema.columns
   WHERE table_name = 'outreach_logs' AND column_name = 'gmail_message_id') AS outreach_gmail_message_id,
  (SELECT count(*) FROM information_schema.tables
   WHERE table_name = 'conversations')  AS t_conversations,
  (SELECT count(*) FROM information_schema.tables
   WHERE table_name = 'reply_events')   AS t_reply_events,
  (SELECT count(*) FROM information_schema.tables
   WHERE table_name = 'followup_runs')  AS t_followup_runs,
  (SELECT count(*) FROM information_schema.tables
   WHERE table_name = 'email_send_log') AS t_email_send_log,
  (SELECT count(*) FROM information_schema.tables
   WHERE table_name = 'worker_heartbeats') AS t_worker_heartbeats,
  (SELECT count(*) FROM information_schema.tables
   WHERE table_name = 'job_runs')       AS t_job_runs,
  (SELECT count(*) FROM information_schema.tables
   WHERE table_name = 'trigger_events') AS t_trigger_events;
-- All values should be 1. Any 0 means that item failed to create.
