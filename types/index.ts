export type CompanyStatus =
  | 'raw'
  | 'enriched'
  | 'scored'
  | 'outreach'
  | 'engaged'
  | 'qualified'
  | 'closed_won'
  | 'closed_lost'
  | 'dormant'

export type Grade = 'A' | 'B' | 'C' | 'D'

export type Channel =
  | 'email'
  | 'linkedin'
  | 'instagram_dm'
  | 'whatsapp'
  | 'phone'
  | 'meeting_invite'

export type ApprovalLevel = 'L1' | 'L2' | 'L3'

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'cancelled' | 'expired'

export type AgentType =
  | 'discovery_agent'
  | 'enrich_agent'
  | 'score_agent'
  | 'outreach_agent'
  | 'followup_agent'
  | 'learn_agent'
  | 'approval_agent'

export type ActionStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped' | 'needs_approval'

export type ReplySentiment = 'positive' | 'neutral' | 'negative' | 'not_interested'

export type ReplyIntent =
  | 'want_catalog'
  | 'want_sample'
  | 'want_quote'
  | 'want_meeting'
  | 'not_interested'
  | 'wrong_person'

export interface Company {
  id: string
  name: string
  domain?: string
  website?: string
  description?: string
  company_type?: string
  business_model?: string[]
  product_categories?: string[]
  employee_count_range?: string
  estimated_annual_revenue?: string
  founded_year?: number
  country?: string
  country_code?: string
  city?: string
  region?: string
  instagram_handle?: string
  instagram_followers?: number
  tiktok_handle?: string
  tiktok_followers?: number
  linkedin_url?: string
  amazon_store_url?: string
  shopify_detected?: boolean
  has_sourcing_need?: boolean
  current_supplier_hints?: string[]
  price_point?: string
  order_volume_hint?: string
  source?: string
  source_url?: string
  source_raw?: Record<string, unknown>
  status: CompanyStatus
  grade?: Grade
  total_score?: number
  enriched_at?: string
  scored_at?: string
  last_activity_at?: string
  created_at: string
  updated_at: string
  assigned_to?: string
}

export interface Contact {
  id: string
  company_id: string
  full_name?: string
  first_name?: string
  last_name?: string
  title?: string
  department?: string
  role_type?: string
  decision_level?: string
  email?: string
  email_verified?: boolean
  email_deliverable?: boolean
  phone?: string
  whatsapp?: string
  linkedin_url?: string
  instagram_handle?: string
  contact_priority?: number
  reply_probability?: number
  last_interaction_at?: string
  source?: string
  status: string
  enriched_at?: string
  created_at: string
  updated_at: string
}

export interface CustomerScore {
  id: string
  company_id: string
  icp_fit_score?: number
  size_score?: number
  profit_potential_score?: number
  reply_probability_score?: number
  category_match_score?: number
  risk_score?: number
  ltv_potential_score?: number
  white_label_fit?: number
  small_order_fit?: number
  dtc_potential?: number
  tiktok_fit?: number
  latam_priority?: number
  total_score?: number
  grade?: Grade
  score_reasoning?: string
  recommended_strategy?: string
  recommended_channels?: string[]
  recommended_assignee?: string
  recommended_priority?: number
  model_version?: string
  scored_at: string
  scored_by: string
}

export interface OutreachLog {
  id: string
  company_id?: string
  contact_id?: string
  channel: Channel
  direction: string
  subject?: string
  body?: string
  template_id?: string
  personalization_data?: Record<string, unknown>
  ab_test_group?: string
  status: string
  sent_at?: string
  delivered_at?: string
  opened_at?: string
  clicked_at?: string
  replied_at?: string
  reply_content?: string
  reply_sentiment?: ReplySentiment
  reply_intent?: ReplyIntent
  executed_by?: string
  approved_by?: string
  created_at: string
}

export interface Approval {
  id: string
  company_id?: string
  contact_id?: string
  agent_action_id?: string
  approval_level: ApprovalLevel
  approval_type: string
  title: string
  description?: string
  action_payload?: Record<string, unknown>
  risk_level?: string
  risk_reasoning?: string
  estimated_value?: number
  status: ApprovalStatus
  requested_by?: string
  reviewed_by?: string
  decision_reason?: string
  decided_at?: string
  expires_at?: string
  created_at: string
}

export interface AgentAction {
  id: string
  company_id?: string
  contact_id?: string
  agent_type: AgentType
  action_type: string
  input_data?: Record<string, unknown>
  output_data?: Record<string, unknown>
  status: ActionStatus
  started_at?: string
  completed_at?: string
  duration_ms?: number
  model_used?: string
  tokens_used?: number
  cost_usd?: number
  error_message?: string
  retry_count: number
  created_at: string
}

export interface FollowupTask {
  id: string
  company_id?: string
  contact_id?: string
  outreach_log_id?: string
  task_type: string
  priority: number
  due_at?: string
  suggested_content?: string
  suggested_channel?: string
  suggested_timing?: string
  reasoning?: string
  status: string
  assigned_to?: string
  executed_by?: string
  completed_at?: string
  created_at: string
  updated_at: string
}

export interface LearningInsight {
  id: string
  insight_type: string
  dimension_key?: string
  dimension_value?: string
  segment?: string
  sample_size?: number
  metric_name?: string
  metric_value?: number
  baseline_value?: number
  improvement_pct?: number
  insight_summary?: string
  recommendation?: string
  confidence_level?: number
  applied_to_rules?: boolean
  period_start?: string
  period_end?: string
  created_at: string
}
