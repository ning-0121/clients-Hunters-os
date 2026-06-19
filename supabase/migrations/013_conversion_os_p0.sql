-- ============================================================
-- Migration 013: Conversion OS — P0
--
-- Account → Opportunity → Activity:
--   deals            — 销售机会（阶段挂这里，一个 company 多个 deal）
--   customer_events  — 统一事件总线（邮件/电话/WhatsApp/会议/展会/拜访/样品/报价/订单/付款/阶段变更/备注）
--   companies        — 关系/账户列（与 deal 阶段完全独立）
--   samples/orders/quote_strategies — 加 deal_id 回链
--
-- 纯增量、幂等、可重跑。不改任何现有列 / 不动 scoring·tiering·quote 引擎。
-- ============================================================

-- ── 1. deals（机会）─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS deals (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id                uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  title                     text NOT NULL,
  stage                     text NOT NULL DEFAULT 'lead',  -- lead|contacted|replied|sample|quotation|negotiation|trial_order|won|lost
  stage_entered_at          timestamptz DEFAULT now(),
  status                    text NOT NULL DEFAULT 'open',  -- open|won|lost
  owner                     text,                          -- 负责人邮箱（同 companies.assigned_to 口径）
  next_action               text,
  next_action_due_at        timestamptz,
  est_value_usd             numeric(12,2),
  expected_close_date       date,
  win_prob                  int,                           -- 0-100，阶段默认 + 人工可改
  product_category          text,
  qty                       int,
  champion_contact_id       uuid REFERENCES contacts(id) ON DELETE SET NULL,  -- D
  decision_maker_contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,  -- D
  lost_reason               text,        -- B: status=lost 时必填（应用层校验）
  annual_potential_usd      numeric(14,2),  -- C: status=won 时必填（应用层校验）
  created_at                timestamptz DEFAULT now(),
  updated_at                timestamptz DEFAULT now(),
  closed_at                 timestamptz
);

-- ── 2. customer_events（统一事件总线）─────────────────────────
CREATE TABLE IF NOT EXISTS customer_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  deal_id     uuid REFERENCES deals(id) ON DELETE SET NULL,
  contact_id  uuid REFERENCES contacts(id) ON DELETE SET NULL,
  event_type  text NOT NULL,  -- email_out|email_in|whatsapp|call|meeting|exhibition|office_visit|sample|quote|negotiation|po|payment|complaint|stage_change|note|task
  direction   text,           -- out|in|internal
  channel     text,           -- email|whatsapp|phone|in_person|system
  occurred_at timestamptz NOT NULL DEFAULT now(),
  title       text NOT NULL,
  body        text,
  owner       text,
  source      text NOT NULL DEFAULT 'system',  -- system|manual
  ref_table   text,
  ref_id      uuid,
  metadata    jsonb,
  created_at  timestamptz DEFAULT now()
);

-- ── 3. companies 关系/账户列（与 deal 阶段独立）─────────────────
ALTER TABLE companies ADD COLUMN IF NOT EXISTS relationship_band     text;       -- cold|warm|hot|champion|dormant|risk（P1 计算，P0 仅落列）
ALTER TABLE companies ADD COLUMN IF NOT EXISTS relationship_band_at  timestamptz;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS account_status        text DEFAULT 'prospect';  -- prospect|active_customer|key_account|strategic_account
ALTER TABLE companies ADD COLUMN IF NOT EXISTS relationship_override text;

-- ── 4. 关联 deal_id（A）──────────────────────────────────────
ALTER TABLE samples          ADD COLUMN IF NOT EXISTS deal_id uuid REFERENCES deals(id) ON DELETE SET NULL;
ALTER TABLE orders           ADD COLUMN IF NOT EXISTS deal_id uuid REFERENCES deals(id) ON DELETE SET NULL;
ALTER TABLE quote_strategies ADD COLUMN IF NOT EXISTS deal_id uuid REFERENCES deals(id) ON DELETE SET NULL;

-- ── 5. 索引 ─────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_deals_company    ON deals(company_id);
CREATE INDEX IF NOT EXISTS idx_deals_open_stage ON deals(stage) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_deals_owner      ON deals(owner) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_events_company   ON customer_events(company_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_deal      ON customer_events(deal_id);

-- ── 6. RLS（沿用 002 的 authenticated_all 模式）──────────────────
ALTER TABLE deals           ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_events ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'deals' AND policyname = 'authenticated_all') THEN
    EXECUTE 'CREATE POLICY authenticated_all ON deals FOR ALL TO authenticated USING (true) WITH CHECK (true)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'customer_events' AND policyname = 'authenticated_all') THEN
    EXECUTE 'CREATE POLICY authenticated_all ON customer_events FOR ALL TO authenticated USING (true) WITH CHECK (true)';
  END IF;
END $$;

-- ── VERIFY（都应 ≥ 1）────────────────────────────────────────
SELECT
  (SELECT count(*) FROM information_schema.tables  WHERE table_name = 'deals')                                          AS t_deals,
  (SELECT count(*) FROM information_schema.tables  WHERE table_name = 'customer_events')                                AS t_events,
  (SELECT count(*) FROM information_schema.columns WHERE table_name = 'companies' AND column_name = 'account_status')   AS c_account_status,
  (SELECT count(*) FROM information_schema.columns WHERE table_name = 'samples'   AND column_name = 'deal_id')          AS c_samples_deal,
  (SELECT count(*) FROM information_schema.columns WHERE table_name = 'orders'    AND column_name = 'deal_id')          AS c_orders_deal;
