/**
 * Customer Intelligence Report — schema + validation.
 *
 * Practical apparel OEM/ODM research report (not generic marketing copy).
 * Every factual field can be "not found" / "needs verification"; the schema
 * never forces a value, so the report agent is not pushed to hallucinate
 * store counts, CEOs, or certifications it could not source.
 */
import { z } from 'zod'

/** How sure are we about an inferred fact. */
export const ConfidenceLabel = z.enum(['Confirmed', 'Likely', 'Needs verification'])
export type ConfidenceLabel = z.infer<typeof ConfidenceLabel>

const MatchLevel = z.enum(['High', 'Medium', 'Low'])
const RequirementStatus = z.enum(['Required', 'Preferred', 'Unknown / needs verification'])

/** A fact that may be unknown. Use null (not a guess) when not sourced. */
const maybe = z.string().nullable().optional()

export const ExecutiveSummarySchema = z.object({
  worth_developing: z.string(),                 // is this customer worth developing + why
  tier: z.enum(['A', 'B', 'C', 'D']),
  horizon: z.enum(['short_term', 'long_term', 'mixed']),
  best_product_angle: z.string(),
  biggest_blocker: z.string(),
  next_step: z.string(),
})

export const CompanyProfileSchema = z.object({
  name: z.string(),
  country: maybe,
  headquarters: maybe,
  founded_year: maybe,
  leadership: maybe,                            // CEO / leadership if available
  store_count: maybe,
  website: maybe,
  ecommerce_channels: z.array(z.string()).nullish().transform((v) => v ?? []),
  market_coverage: maybe,
  brand_positioning: maybe,
})

export const BusinessModelSchema = z.object({
  classification: z.array(z.enum([
    'dtc_brand', 'retail_chain', 'importer', 'distributor', 'off_price_buyer',
    'marketplace_seller', 'showroom', 'sourcing_office', 'brand_owner', 'hybrid',
  ])).nullish().transform((v) => v ?? []),
  reasoning: maybe,
})

const ProductLineSchema = z.object({
  category: z.string(),
  confidence: ConfidenceLabel,
})

const ProductMatchItemSchema = z.object({
  category: z.string(),
  match_level: MatchLevel,
  suggested_qimo_product: z.string(),
  why_it_matches: z.string(),
  risk_difficulty: maybe,
  recommended_entry_sku: maybe,
})

export const ComplianceRequirementsSchema = z.object({
  items: z.array(z.object({
    requirement: z.string(),                    // e.g. "SMETA", "Supplier code of conduct"
    status: RequirementStatus,
    note: maybe,
  })).nullish().transform((v) => v ?? []),
  current_factory_can_support: z.string(),      // can current QIMO factory support this?
  partner_factory_needed: z.boolean(),
  bsci_wrap_renewal_enough: maybe,
  smeta_partner_needed: z.boolean(),
})

export const SupplierEntryPathSchema = z.object({
  application_url: maybe,
  has_portal: z.boolean().default(false),
  required_documents: z.array(z.string()).nullish().transform((v) => v ?? []),
  application_sequence: z.array(z.string()).nullish().transform((v) => v ?? []),
  follow_up_method: maybe,
  manual_strategy: maybe,                       // fallback if no portal found
})

export const ContactStrategySchema = z.object({
  target_titles: z.array(z.string()).nullish().transform((v) => v ?? []),
  linkedin_search_queries: z.array(z.string()).nullish().transform((v) => v ?? []),
  notes: maybe,
})

const OutreachAngleSchema = z.object({
  angle: z.string(),                            // e.g. "Seamless capacity angle"
  pitch: z.string(),
})

const RiskItemSchema = z.object({
  risk: z.string(),
  severity: z.enum(['low', 'medium', 'high']),
  note: maybe,
})

const ActionSchema = z.object({
  action: z.string(),
  priority: z.enum(['now', 'soon', 'later']).default('soon'),
})

export const DraftMessagesSchema = z.object({
  first_outreach_email: z.object({ subject: z.string(), body: z.string() }),
  linkedin_message: z.string(),
  follow_up_email: z.object({ subject: z.string(), body: z.string() }),
  supplier_portal_intro: z.string(),
})

const SourceUrlSchema = z.object({
  url: z.string(),
  used_for: z.string(),                         // what we learned from it
})

export const CustomerReportSchema = z.object({
  executive_summary: ExecutiveSummarySchema,
  company_profile: CompanyProfileSchema,
  business_model: BusinessModelSchema,
  product_lines: z.array(ProductLineSchema).nullish().transform((v) => v ?? []),
  product_match: z.array(ProductMatchItemSchema).nullish().transform((v) => v ?? []),
  compliance_requirements: ComplianceRequirementsSchema,
  supplier_entry_path: SupplierEntryPathSchema,
  contact_strategy: ContactStrategySchema,
  outreach_angles: z.array(OutreachAngleSchema).nullish().transform((v) => v ?? []),
  risk_assessment: z.array(RiskItemSchema).nullish().transform((v) => v ?? []),
  recommended_actions: z.array(ActionSchema).nullish().transform((v) => v ?? []),
  draft_messages: DraftMessagesSchema,
  source_urls: z.array(SourceUrlSchema).nullish().transform((v) => v ?? []),
  confidence_score: z.number().min(0).max(1),
})

export type CustomerReport = z.infer<typeof CustomerReportSchema>

export interface ReportValidation {
  ok: boolean
  report?: CustomerReport
  errors?: string[]
}

/** Validate + coerce an LLM JSON object into a CustomerReport. */
export function validateReport(raw: unknown): ReportValidation {
  const result = CustomerReportSchema.safeParse(raw)
  if (result.success) return { ok: true, report: result.data }
  return {
    ok: false,
    errors: result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
  }
}
