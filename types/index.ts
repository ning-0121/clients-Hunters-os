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
  | 'send_email_agent'
  | 'followup_agent'
  | 'learn_agent'
  | 'approval_agent'
  | 'tiering_agent'
  | 'report_agent'

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
  // ── Customer tiering (business feasibility — distinct from `grade`) ──
  customer_tier?: CustomerTier
  tier_reasoning?: string
  compliance_level?: ComplianceLevel
  compliance_requirements?: string[]
  compliance_blockers?: string[]
  conversion_feasibility_score?: number
  strategic_value_score?: number
  customer_scale_score?: number
  product_match_score?: number
  product_match?: ProductMatchItem[]
  payment_risk_score?: number
  recommended_development_strategy?: string
  recommended_factory_type?: RecommendedFactoryType
  recommended_factory_id?: string
  target_customer_segment?: TargetCustomerSegment
  next_action?: string
  tiered_at?: string
  // ── Domestic Chinese trading-company segment ──
  domestic_company_type?: DomesticCompanyType
  development_purpose?: DevelopmentPurpose
  order_partner_potential_score?: number
  software_customer_potential_score?: number
  management_pain_signals?: string[]
  recruitment_signals?: string[]
  domestic_region?: string
  recommended_domestic_strategy?: string
}

export type TargetCustomerSegment =
  | 'overseas_brand' | 'overseas_importer' | 'retailer_chain' | 'offprice_buyer'
  | 'domestic_trading_company' | 'domestic_factory' | 'domestic_ecommerce_seller'
  | 'domestic_supplier' | 'agency_partner'

export type DomesticCompanyType =
  | 'apparel_trading_company' | 'activewear_trading_company' | 'general_import_export_company'
  | 'cross_border_ecommerce_seller' | 'sourcing_agent' | 'factory_with_export_department'
  | 'software_prospect'

export type DevelopmentPurpose =
  | 'order_cooperation' | 'software_sales' | 'channel_partnership'
  | 'supplier_partnership' | 'unknown'

export type CustomerTier = 'A' | 'B' | 'C' | 'D'

export type ComplianceLevel =
  | 'none' | 'basic_docs' | 'bsci_wrap' | 'sedex_smeta'
  | 'oeko_grs' | 'customer_audit' | 'supplier_portal'

export type RecommendedFactoryType =
  | 'current' | 'current_after_renewal' | 'partner_smeta'
  | 'partner_or_current' | 'unknown'

export interface ProductMatchItem {
  category: string
  level: string
  suggested_sku?: string
  reason?: string
}

export interface CustomerIntelligenceReport {
  id: string
  company_id: string
  report_version: number
  report_depth: 'short' | 'standard' | 'deep'
  report_kind?: 'overseas' | 'domestic'
  domestic_report?: Record<string, unknown>
  customer_tier?: CustomerTier
  executive_summary?: Record<string, unknown>
  company_profile?: Record<string, unknown>
  business_model?: Record<string, unknown>
  product_lines?: Record<string, unknown>[]
  product_match?: Record<string, unknown>[]
  compliance_requirements?: Record<string, unknown>
  supplier_entry_path?: Record<string, unknown>
  contact_strategy?: Record<string, unknown>
  outreach_angles?: Record<string, unknown>[]
  risk_assessment?: Record<string, unknown>[]
  recommended_actions?: Record<string, unknown>[]
  draft_messages?: Record<string, unknown>
  source_urls?: Record<string, unknown>[]
  confidence_score?: number
  created_by?: string
  created_at: string
  updated_at: string
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

export type TaskType =
  | 'reply_needed'
  | 'sample_followup'
  | 'quote_followup'
  | 'meeting_prep'
  | 'approval_needed'
  | 'dormant_reactivation'
  | 'manual'

export type TaskStatus = 'open' | 'in_progress' | 'done' | 'dismissed'

export interface Task {
  id: string
  company_id?: string
  contact_id?: string
  conversation_id?: string
  reply_event_id?: string
  task_type: TaskType
  priority: number
  title: string
  detail?: string
  suggested_action?: string
  status: TaskStatus
  assigned_to?: string
  due_at?: string
  completed_at?: string
  completed_by?: string
  source: string
  created_at: string
  updated_at: string
}

export type SampleStatus =
  | 'requested'
  | 'confirmed'
  | 'in_production'
  | 'shipped'
  | 'delivered'
  | 'feedback_received'
  | 'approved'
  | 'rejected'

export interface Sample {
  id: string
  company_id?: string
  contact_id?: string
  conversation_id?: string
  styles_requested?: string[]
  quantity?: number
  spec_notes?: string
  shipping_name?: string
  shipping_address?: string
  shipping_country?: string
  shipping_phone?: string
  status: SampleStatus
  sample_cost_usd?: number
  cost_borne_by?: string
  pushed_to_metronome?: boolean
  metronome_ref?: string
  confirmed_at?: string
  shipped_at?: string
  tracking_number?: string
  carrier?: string
  delivered_at?: string
  feedback?: string
  feedback_at?: string
  created_at: string
  updated_at: string
}

export type OrderStatus = 'draft' | 'confirmed' | 'in_production' | 'shipped' | 'delivered' | 'cancelled'

export interface Order {
  id: string
  company_id?: string
  contact_id?: string
  conversation_id?: string
  sample_id?: string
  order_ref?: string
  order_value_usd?: number
  product_lines?: Record<string, unknown>[]
  moq_agreed?: number
  payment_terms?: string
  required_delivery?: string
  destination_port?: string
  shipping_method?: string
  brand_requirements?: string
  is_repeat?: boolean
  previous_order_id?: string
  status: OrderStatus
  pushed_to_metronome?: boolean
  metronome_ref?: string
  created_at: string
  updated_at: string
}

export interface ReportQualityReview {
  id: string
  company_id?: string
  report_id?: string
  reviewer?: string
  overall_score?: number
  accuracy_score?: number
  usefulness_score?: number
  compliance_accuracy_score?: number
  product_match_score?: number
  next_action_quality_score?: number
  notes?: string
  created_at: string
}

export type FactoryType = 'own_factory' | 'partner_factory'

export interface FactoryProfile {
  id: string
  name: string
  location?: string
  factory_type?: FactoryType
  main_categories?: string[]
  monthly_capacity?: string
  moq_range?: string
  price_level?: 'low' | 'medium' | 'high'
  cooperation_status?: string
  notes?: string
  created_at: string
  updated_at: string
}

export interface FactoryCertification {
  id: string
  factory_id: string
  certification_type?: string
  status?: 'valid' | 'expired' | 'in_renewal' | 'planned' | 'unknown'
  expiry_date?: string
  document_url?: string
  notes?: string
}

export interface FactoryCapability {
  id: string
  factory_id: string
  category?: string
  capability_level?: 'strong' | 'medium' | 'weak'
  suitable_customer_tiers?: string[]
  suitable_regions?: string[]
  risk_notes?: string
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
