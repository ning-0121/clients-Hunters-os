-- ============================================================
-- Migration 003: BD Workflow — Post-Reply, Samples, Tasks
-- Closes the bottom of the funnel: reply → task → sample → order
--
-- Safe to re-run (IF NOT EXISTS everywhere, DO blocks for constraints)
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- 1. TASKS — daily work queue for salespeople (and AI)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tasks (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       UUID REFERENCES companies(id) ON DELETE CASCADE,
  contact_id       UUID REFERENCES contacts(id) ON DELETE SET NULL,
  conversation_id  UUID REFERENCES conversations(id) ON DELETE SET NULL,
  reply_event_id   UUID REFERENCES reply_events(id) ON DELETE SET NULL,
  sample_id        UUID,   -- FK added after samples table is created (see below)
  -- task_type: reply_needed | sample_followup | quote_followup | meeting_prep
  --            approval_needed | dormant_reactivation | manual
  task_type        TEXT NOT NULL,
  priority         INT  DEFAULT 5,            -- 1 (highest) .. 9 (lowest)
  title            TEXT NOT NULL,
  detail           TEXT,
  -- AI-suggested response, if any
  suggested_action TEXT,
  status           TEXT DEFAULT 'open',       -- open | in_progress | done | dismissed
  assigned_to      TEXT,                      -- salesperson identifier (email/name), null = unassigned
  due_at           TIMESTAMPTZ,
  completed_at     TIMESTAMPTZ,
  completed_by     TEXT,
  source           TEXT DEFAULT 'ai',         -- ai | human | system
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────
-- 2. SAMPLES — sample request tracking (manufacturer conversion mechanism)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS samples (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         UUID REFERENCES companies(id) ON DELETE CASCADE,
  contact_id         UUID REFERENCES contacts(id) ON DELETE SET NULL,
  conversation_id    UUID REFERENCES conversations(id) ON DELETE SET NULL,
  -- what they want
  styles_requested   TEXT[],                  -- e.g. {"yoga leggings","sports bra"}
  quantity           INT,
  spec_notes         TEXT,                    -- fabric, color, custom requirements
  -- logistics
  shipping_name      TEXT,
  shipping_address   TEXT,
  shipping_country   TEXT,
  shipping_phone     TEXT,
  -- lifecycle
  status             TEXT DEFAULT 'requested',  -- requested | confirmed | in_production
                                                --  | shipped | delivered | feedback_received
                                                --  | approved | rejected
  sample_cost_usd    NUMERIC(10,2),
  cost_borne_by      TEXT,                    -- factory | customer | split
  -- handoff to 节拍器 (production system)
  pushed_to_metronome    BOOLEAN DEFAULT FALSE,
  metronome_ref          TEXT,                -- order/sample id returned by 节拍器
  -- tracking
  confirmed_at       TIMESTAMPTZ,
  shipped_at         TIMESTAMPTZ,
  tracking_number    TEXT,
  carrier            TEXT,
  delivered_at       TIMESTAMPTZ,
  feedback           TEXT,
  feedback_at        TIMESTAMPTZ,
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  updated_at         TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────
-- 3. ORDERS — first/repeat order records (handoff to 节拍器)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS orders (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         UUID REFERENCES companies(id) ON DELETE CASCADE,
  contact_id         UUID REFERENCES contacts(id) ON DELETE SET NULL,
  conversation_id    UUID REFERENCES conversations(id) ON DELETE SET NULL,
  sample_id          UUID REFERENCES samples(id) ON DELETE SET NULL,
  order_ref          TEXT,                    -- internal reference / PO number
  order_value_usd    NUMERIC(12,2),
  product_lines      JSONB,                   -- [{style, sku, qty, color, size, unit_price}]
  moq_agreed         INT,
  payment_terms      TEXT,                    -- e.g. "30% deposit, 70% before shipping"
  required_delivery  DATE,
  destination_port   TEXT,
  shipping_method    TEXT,
  brand_requirements TEXT,                    -- certs, hangtags, labeling
  is_repeat          BOOLEAN DEFAULT FALSE,
  previous_order_id  UUID REFERENCES orders(id) ON DELETE SET NULL,
  status             TEXT DEFAULT 'draft',    -- draft | confirmed | in_production
                                              --  | shipped | delivered | cancelled
  -- handoff to 节拍器
  pushed_to_metronome  BOOLEAN DEFAULT FALSE,
  metronome_ref        TEXT,
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  updated_at         TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────
-- 4. METRONOME HANDOFFS — outbound event log to production system
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS metronome_handoffs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type     TEXT NOT NULL,             -- sample | order
  entity_id       UUID NOT NULL,
  company_id      UUID REFERENCES companies(id) ON DELETE CASCADE,
  payload         JSONB,
  status          TEXT DEFAULT 'pending',    -- pending | pushed | error
  metronome_ref   TEXT,
  error_message   TEXT,
  pushed_at       TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────
-- 5. CONVERSATIONS — add fields for richer thread state
-- ─────────────────────────────────────────────────────────────
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS assigned_to       TEXT,
  ADD COLUMN IF NOT EXISTS next_action       TEXT,
  ADD COLUMN IF NOT EXISTS next_action_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS stage             TEXT DEFAULT 'outreach';
  -- stage: outreach | replied | sampling | negotiating | won | lost

-- companies: assignment + shipping (for sample address capture)
ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS assigned_to        TEXT;

-- Now wire tasks.sample_id → samples(id) (samples table exists by now)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tasks_sample_id_fkey'
  ) THEN
    ALTER TABLE tasks ADD CONSTRAINT tasks_sample_id_fkey
      FOREIGN KEY (sample_id) REFERENCES samples(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────
-- 6. INDEXES
-- ─────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_tasks_open        ON tasks(status, priority, due_at) WHERE status IN ('open','in_progress');
CREATE INDEX IF NOT EXISTS idx_tasks_assigned     ON tasks(assigned_to, status);
CREATE INDEX IF NOT EXISTS idx_tasks_company       ON tasks(company_id);
CREATE INDEX IF NOT EXISTS idx_samples_company      ON samples(company_id);
CREATE INDEX IF NOT EXISTS idx_samples_status        ON samples(status);
CREATE INDEX IF NOT EXISTS idx_orders_company         ON orders(company_id);
CREATE INDEX IF NOT EXISTS idx_orders_status           ON orders(status);
CREATE INDEX IF NOT EXISTS idx_handoffs_pending         ON metronome_handoffs(status) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_conversations_assigned    ON conversations(assigned_to);

-- ─────────────────────────────────────────────────────────────
-- 7. RLS
-- ─────────────────────────────────────────────────────────────
ALTER TABLE tasks               ENABLE ROW LEVEL SECURITY;
ALTER TABLE samples             ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders              ENABLE ROW LEVEL SECURITY;
ALTER TABLE metronome_handoffs  ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'tasks'              AND policyname = 'authenticated_all') THEN
    EXECUTE 'CREATE POLICY authenticated_all ON tasks              FOR ALL TO authenticated USING (true)'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'samples'            AND policyname = 'authenticated_all') THEN
    EXECUTE 'CREATE POLICY authenticated_all ON samples            FOR ALL TO authenticated USING (true)'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'orders'             AND policyname = 'authenticated_all') THEN
    EXECUTE 'CREATE POLICY authenticated_all ON orders             FOR ALL TO authenticated USING (true)'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'metronome_handoffs' AND policyname = 'authenticated_all') THEN
    EXECUTE 'CREATE POLICY authenticated_all ON metronome_handoffs FOR ALL TO authenticated USING (true)'; END IF;
END $$;

-- ─────────────────────────────────────────────────────────────
-- VERIFY — all values should be 1
-- ─────────────────────────────────────────────────────────────
SELECT
  (SELECT count(*) FROM information_schema.tables WHERE table_name = 'tasks')              AS t_tasks,
  (SELECT count(*) FROM information_schema.tables WHERE table_name = 'samples')            AS t_samples,
  (SELECT count(*) FROM information_schema.tables WHERE table_name = 'orders')             AS t_orders,
  (SELECT count(*) FROM information_schema.tables WHERE table_name = 'metronome_handoffs') AS t_handoffs,
  (SELECT count(*) FROM information_schema.columns WHERE table_name = 'conversations' AND column_name = 'stage')       AS c_conv_stage,
  (SELECT count(*) FROM information_schema.columns WHERE table_name = 'companies'     AND column_name = 'assigned_to') AS c_co_assigned;
-- All values should be 1.
