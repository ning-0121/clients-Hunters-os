-- ============================================
-- ARAOS Initial Schema
-- ============================================

-- Companies
CREATE TABLE IF NOT EXISTS companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  domain TEXT,
  website TEXT,
  description TEXT,
  company_type TEXT,
  business_model TEXT[],
  product_categories TEXT[],
  employee_count_range TEXT,
  estimated_annual_revenue TEXT,
  founded_year INT,
  country TEXT,
  country_code TEXT,
  city TEXT,
  region TEXT,
  instagram_handle TEXT,
  instagram_followers INT,
  tiktok_handle TEXT,
  tiktok_followers INT,
  linkedin_url TEXT,
  amazon_store_url TEXT,
  shopify_detected BOOLEAN DEFAULT FALSE,
  has_sourcing_need BOOLEAN,
  current_supplier_hints TEXT[],
  price_point TEXT,
  order_volume_hint TEXT,
  source TEXT,
  source_url TEXT,
  source_raw JSONB,
  status TEXT DEFAULT 'raw',
  grade TEXT,
  total_score NUMERIC(5,2),
  enriched_at TIMESTAMPTZ,
  scored_at TIMESTAMPTZ,
  last_activity_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  assigned_to UUID,
  created_by UUID
);

-- Contacts
CREATE TABLE IF NOT EXISTS contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  full_name TEXT,
  first_name TEXT,
  last_name TEXT,
  title TEXT,
  department TEXT,
  role_type TEXT,
  decision_level TEXT,
  email TEXT,
  email_verified BOOLEAN DEFAULT FALSE,
  email_deliverable BOOLEAN,
  phone TEXT,
  whatsapp TEXT,
  linkedin_url TEXT,
  instagram_handle TEXT,
  contact_priority INT DEFAULT 0,
  reply_probability NUMERIC(4,2),
  last_interaction_at TIMESTAMPTZ,
  source TEXT,
  source_url TEXT,
  status TEXT DEFAULT 'uncontacted',
  enriched_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Customer Scores
CREATE TABLE IF NOT EXISTS customer_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE UNIQUE,
  icp_fit_score NUMERIC(4,2),
  size_score NUMERIC(4,2),
  profit_potential_score NUMERIC(4,2),
  reply_probability_score NUMERIC(4,2),
  category_match_score NUMERIC(4,2),
  risk_score NUMERIC(4,2),
  ltv_potential_score NUMERIC(4,2),
  white_label_fit NUMERIC(4,2),
  small_order_fit NUMERIC(4,2),
  dtc_potential NUMERIC(4,2),
  tiktok_fit NUMERIC(4,2),
  latam_priority NUMERIC(4,2),
  total_score NUMERIC(5,2),
  grade TEXT,
  score_reasoning TEXT,
  recommended_strategy TEXT,
  recommended_channels TEXT[],
  recommended_assignee TEXT,
  recommended_priority INT,
  model_version TEXT,
  scored_at TIMESTAMPTZ DEFAULT NOW(),
  scored_by TEXT DEFAULT 'ai'
);

-- Outreach Logs
CREATE TABLE IF NOT EXISTS outreach_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id),
  contact_id UUID REFERENCES contacts(id),
  channel TEXT NOT NULL,
  direction TEXT DEFAULT 'outbound',
  subject TEXT,
  body TEXT,
  template_id UUID,
  personalization_data JSONB,
  ab_test_group TEXT,
  status TEXT DEFAULT 'draft',
  sent_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  opened_at TIMESTAMPTZ,
  clicked_at TIMESTAMPTZ,
  replied_at TIMESTAMPTZ,
  reply_content TEXT,
  reply_sentiment TEXT,
  reply_intent TEXT,
  executed_by TEXT,
  approved_by UUID,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Followup Tasks
CREATE TABLE IF NOT EXISTS followup_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id),
  contact_id UUID REFERENCES contacts(id),
  outreach_log_id UUID REFERENCES outreach_logs(id),
  task_type TEXT,
  priority INT DEFAULT 5,
  due_at TIMESTAMPTZ,
  suggested_content TEXT,
  suggested_channel TEXT,
  suggested_timing TEXT,
  reasoning TEXT,
  status TEXT DEFAULT 'pending',
  assigned_to UUID,
  executed_by TEXT,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Approvals
CREATE TABLE IF NOT EXISTS approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id),
  contact_id UUID REFERENCES contacts(id),
  agent_action_id UUID,
  approval_level TEXT,
  approval_type TEXT,
  title TEXT,
  description TEXT,
  action_payload JSONB,
  risk_level TEXT,
  risk_reasoning TEXT,
  estimated_value NUMERIC(12,2),
  status TEXT DEFAULT 'pending',
  requested_by TEXT,
  reviewed_by UUID,
  decision_reason TEXT,
  decided_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Agent Actions
CREATE TABLE IF NOT EXISTS agent_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id),
  contact_id UUID REFERENCES contacts(id),
  agent_type TEXT,
  action_type TEXT,
  input_data JSONB,
  output_data JSONB,
  status TEXT DEFAULT 'pending',
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  duration_ms INT,
  model_used TEXT,
  tokens_used INT,
  cost_usd NUMERIC(10,6),
  error_message TEXT,
  retry_count INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Agent Queue
CREATE TABLE IF NOT EXISTS agent_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_type TEXT NOT NULL,
  priority INT DEFAULT 5,
  payload JSONB NOT NULL,
  status TEXT DEFAULT 'waiting',
  attempts INT DEFAULT 0,
  max_attempts INT DEFAULT 3,
  scheduled_for TIMESTAMPTZ DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  error_log JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Learning Insights
CREATE TABLE IF NOT EXISTS learning_insights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  insight_type TEXT,
  dimension_key TEXT,
  dimension_value TEXT,
  segment TEXT,
  sample_size INT,
  metric_name TEXT,
  metric_value NUMERIC(10,4),
  baseline_value NUMERIC(10,4),
  improvement_pct NUMERIC(8,2),
  insight_summary TEXT,
  recommendation TEXT,
  confidence_level NUMERIC(4,2),
  applied_to_rules BOOLEAN DEFAULT FALSE,
  period_start TIMESTAMPTZ,
  period_end TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Quotes
CREATE TABLE IF NOT EXISTS quotes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id),
  contact_id UUID REFERENCES contacts(id),
  quote_number TEXT UNIQUE,
  status TEXT DEFAULT 'draft',
  line_items JSONB,
  total_value NUMERIC(12,2),
  currency TEXT DEFAULT 'USD',
  moq INT,
  lead_time_days INT,
  validity_days INT DEFAULT 30,
  special_terms TEXT,
  payment_terms TEXT,
  created_by TEXT,
  approved_by UUID,
  sent_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Samples
CREATE TABLE IF NOT EXISTS samples (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id),
  contact_id UUID REFERENCES contacts(id),
  status TEXT DEFAULT 'requested',
  sample_type TEXT,
  items JSONB,
  total_value NUMERIC(10,2),
  shipping_address JSONB,
  tracking_number TEXT,
  courier TEXT,
  requires_approval BOOLEAN DEFAULT TRUE,
  approved_by UUID,
  requested_at TIMESTAMPTZ DEFAULT NOW(),
  shipped_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  feedback_received_at TIMESTAMPTZ,
  feedback TEXT
);

-- Meetings
CREATE TABLE IF NOT EXISTS meetings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id),
  contact_id UUID REFERENCES contacts(id),
  meeting_type TEXT,
  title TEXT,
  scheduled_at TIMESTAMPTZ,
  duration_mins INT DEFAULT 30,
  timezone TEXT,
  platform TEXT,
  meeting_url TEXT,
  status TEXT DEFAULT 'proposed',
  ai_briefing TEXT,
  ai_questions TEXT[],
  notes TEXT,
  action_items JSONB,
  outcome TEXT,
  assigned_to UUID,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- Indexes
-- ============================================
CREATE INDEX IF NOT EXISTS idx_companies_status ON companies(status);
CREATE INDEX IF NOT EXISTS idx_companies_grade ON companies(grade);
CREATE INDEX IF NOT EXISTS idx_companies_country ON companies(country);
CREATE INDEX IF NOT EXISTS idx_companies_score ON companies(total_score DESC);
CREATE INDEX IF NOT EXISTS idx_outreach_company ON outreach_logs(company_id);
CREATE INDEX IF NOT EXISTS idx_outreach_status ON outreach_logs(status);
CREATE INDEX IF NOT EXISTS idx_followup_due ON followup_tasks(due_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_approvals_pending ON approvals(status) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_queue_waiting ON agent_queue(priority DESC, scheduled_for) WHERE status = 'waiting';

-- ============================================
-- Queue claim function (prevents concurrent job stealing)
-- ============================================
CREATE OR REPLACE FUNCTION claim_queue_jobs(p_limit INT, p_worker_id TEXT)
RETURNS SETOF agent_queue
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  UPDATE agent_queue
  SET status = 'active', started_at = NOW()
  WHERE id IN (
    SELECT id FROM agent_queue
    WHERE status = 'waiting'
      AND scheduled_for <= NOW()
    ORDER BY priority DESC, scheduled_for ASC
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
END;
$$;

-- ============================================
-- RLS Policies (adjust based on your auth setup)
-- ============================================
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE outreach_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE followup_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE learning_insights ENABLE ROW LEVEL SECURITY;
ALTER TABLE quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE samples ENABLE ROW LEVEL SECURITY;
ALTER TABLE meetings ENABLE ROW LEVEL SECURITY;

-- Allow all authenticated users to read/write (tighten later)
CREATE POLICY "authenticated_all" ON companies FOR ALL TO authenticated USING (true);
CREATE POLICY "authenticated_all" ON contacts FOR ALL TO authenticated USING (true);
CREATE POLICY "authenticated_all" ON customer_scores FOR ALL TO authenticated USING (true);
CREATE POLICY "authenticated_all" ON outreach_logs FOR ALL TO authenticated USING (true);
CREATE POLICY "authenticated_all" ON approvals FOR ALL TO authenticated USING (true);
CREATE POLICY "authenticated_all" ON agent_actions FOR ALL TO authenticated USING (true);
CREATE POLICY "authenticated_all" ON agent_queue FOR ALL TO authenticated USING (true);
CREATE POLICY "authenticated_all" ON followup_tasks FOR ALL TO authenticated USING (true);
CREATE POLICY "authenticated_all" ON learning_insights FOR ALL TO authenticated USING (true);
CREATE POLICY "authenticated_all" ON quotes FOR ALL TO authenticated USING (true);
CREATE POLICY "authenticated_all" ON samples FOR ALL TO authenticated USING (true);
CREATE POLICY "authenticated_all" ON meetings FOR ALL TO authenticated USING (true);
