/**
 * Customer Intelligence Brief — shared types.
 *
 * A decision brief (not a background report): 10 sections that tell the salesperson
 * whether/what/who/how to develop an account. Built by a PURE, deterministic
 * inference layer (lib/intel/*) from data we already store — no LLM in the decision
 * path, so the brief is stable, explainable, unit-testable, and instant.
 */
import type { AccessResult } from '@/lib/contacts/access'

// ── Enums ────────────────────────────────────────────────────────────────────
export type Rating = 'A' | 'B' | 'C' | 'D'
export type GoDecision = 'go' | 'hold' | 'no_go'
export type Priority = 'high' | 'medium' | 'low'
export type MarginBand = 'high' | 'medium' | 'low' | 'thin'
export type ResourceLevel = 'heavy' | 'standard' | 'light' | 'minimal'
export type AllocationAction = 'strike' | 'hunt' | 'nurture' | 'hold' | 'abandon'
export type Sensitivity = 'high' | 'medium' | 'low'
export type Complexity = 'low' | 'medium' | 'high'
export type CompeteAxis = 'price' | 'speed' | 'development' | 'quality' | 'reliability'

export type CustomerType =
  | 'premium_dtc'
  | 'growth_activewear'
  | 'off_price_discount'
  | 'wholesale_trade'
  | 'retail_private_label'
  | 'ecom_micro'
  | 'distributor_importer'
  | 'unqualified'

export type PurchasingModel =
  | 'oem_direct'
  | 'trading_company'
  | 'importer'
  | 'private_label'
  | 'off_price_channel'
  | 'inventory_clearance'
  | 'small_batch_dtc'
  | 'seasonal_program'

// ── Inputs (decoupled from the DB row) ─────────────────────────────────────────
export interface CompanyFacts {
  name: string
  domain?: string | null
  website?: string | null
  country?: string | null
  companyType?: string | null
  productCategories: string[]
  pricePoint?: string | null            // budget | mid | premium | luxury | null
  employeeRange?: string | null
  instagramFollowers?: number | null
  tiktokFollowers?: number | null
  shopifyDetected?: boolean | null
  techStack: string[]
  customerTier?: Rating | null
  productMatch: ProductMatchItem[]       // existing structured product_match
  customerScaleScore?: number | null     // 0-10
  productMatchScore?: number | null       // 0-10
  strategicValueScore?: number | null     // 0-10
  conversionFeasibilityScore?: number | null  // 0-10
  paymentRiskScore?: number | null        // 0-10 (higher = riskier)
  description?: string | null
  customsEvidence?: boolean               // import/customs records exist
  customsText?: string | null             // raw customs snippets (origin/supplier evidence)
  city?: string | null
  region?: string | null
  complianceLevel?: string | null         // none | bsci_wrap | sedex_smeta | oeko_grs | ...
  complianceRequirements?: string[]       // concrete audits/certs required (验厂)
  complianceBlockers?: string[]           // what blocks first order today
  currentSuppliers?: string[]             // current_supplier_hints (incumbent suppliers)
  fundingDetected?: boolean
  foundedYear?: number | null
  estimatedAnnualRevenue?: string | null
  hqAddress?: string | null               // real HQ address (e.g. ImportYeti import records)
  customsOrigins?: string[]               // ISO origin countries from customs records
  customsShipments?: number | null        // total import shipments (volume evidence)
}

export interface ProductMatchItem {
  category?: string
  level?: string                          // High | Medium | Low
  suggested_qimo_product?: string
  reason?: string
}

export interface BriefContact {
  id?: string | null
  fullName?: string | null
  title?: string | null
  roleType?: string | null
  decisionLevel?: string | null
  email?: string | null
  emailVerified?: boolean | null
  emailSource?: string | null
  emailConfidence?: number | null
  linkedin?: string | null
  phone?: string | null
  status?: string | null
}

export interface BriefInputs {
  company: CompanyFacts
  contacts: BriefContact[]
  access: AccessResult
  quoteCategories: string[]               // product_category from quote_strategies
  openDeals: number
}

// ── Section outputs ────────────────────────────────────────────────────────────
export interface ExecutiveDecision {
  rating: Rating
  decision: GoDecision
  priority: Priority
  annualPotentialUsd: { low: number; high: number } | null
  marginBand: MarginBand
  winProbability: number                  // 0-100
  resourceLevel: ResourceLevel
  headline: string                        // 30-second readable summary
}

export interface CustomerTypeProfile {
  type: CustomerType
  label: string
  confidence: number                      // 0-1
  rationale: string[]
  buyingBehavior: string
  priceSensitivity: Sensitivity
  qualitySensitivity: Sensitivity
  developmentNeeds: string
  likelyDecisionMaker: string
  bestApproach: string
}

export interface PurchasingModelInference {
  model: PurchasingModel
  label: string
  confidence: number
  evidence: string[]
}

export interface ProductSupplyFit {
  coreCategories: string[]
  fabricTypes: string[]
  constructionComplexity: Complexity
  qimoFitScore: number                    // 0-100
  cutInProducts: string[]
  productsToAvoid: string[]
  targetFobRange: string
  factoryRequirement: string
  likelySourcingCountry: string
  switchingDifficulty: Complexity
}

export type ChainStatus = 'found' | 'inferred' | 'missing'
export interface ChainRole {
  status: ChainStatus
  name?: string | null
  title: string
  note: string
  // Actual contact method, so the brief is operable (manual outreach) — not just
  // a name + "可达" label. Populated only when a real contact backs the role.
  contactId?: string | null
  email?: string | null
  linkedin?: string | null
  phone?: string | null
  reachable?: boolean
}
export interface DecisionChain {
  decisionMaker: ChainRole
  influencer: ChainRole
  buyer: ChainRole
  gatekeeper: ChainRole
  missingRoles: string[]
  accessScore: number
  accessCoverage: string
  recommendedNextContact: string
  contactPriorityLadder: string[]
}

export interface ContactStrategy {
  bestFirstContact: string
  backupPath: string
  linkedinStrategy: string
  emailStrategy: string
  websiteStrategy: string
  customerServiceScript: string
  whatNotToSay: string[]
}

export interface WinningStrategy {
  howToWin: string
  painPoint: string
  leadProduct: string
  sampleToShow: string
  quoteStrategy: string
  competeOn: CompeteAxis[]
  pushDirectFactory: boolean
  offerSampleDevelopment: boolean
  positioning: 'primary_supplier' | 'backup_supplier'
  summary: string
}

export interface RiskItem {
  risk: string
  severity: 'low' | 'medium' | 'high'
  note: string
}
export interface RiskAssessment {
  items: RiskItem[]
  strategicAccount: boolean
  quickWin: boolean
  lowMarginVolume: boolean
}

export interface ResourceAllocation {
  action: AllocationAction
  rationale: string
  salesEffortHours: string
  sampleBudgetUsd: number
  discoveryEffort: string
  ownerInvolved: boolean
  worthOfflineVisit: boolean
  worthLongTermNurture: boolean
  returnVsEffort: string
}

export type NextActionKind =
  | 'find_contact' | 'email' | 'sample' | 'quote' | 'search' | 'cs_probe' | 'followup' | 'deal'
export interface NextAction {
  kind: NextActionKind
  task: string
  detail?: string
}

export interface AccountProfile {
  location: string                        // city, region, country (what we have)
  hqAddress: string | null                // null = UNKNOWN (no source yet)
  chinaOffice: string | null              // null = UNKNOWN (needs discovery)
  salesChannel: string                    // DTC / wholesale / marketplace ...
  complianceLabel: string                 // 验厂/合规 bar (human label)
  complianceRequirements: string[]
  complianceBlockers: string[]
  currentSuppliers: string[]              // incumbent suppliers (switching context)
  customsStatus: string                   // import-records status
  credit: { band: string; riskScore: number; confidence: number; recommendation: string }
}

export interface IntelligenceBrief {
  version: number
  generatedAt?: string                    // set by the caller when caching
  accountProfile: AccountProfile
  executive: ExecutiveDecision
  customerType: CustomerTypeProfile
  purchasingModel: PurchasingModelInference
  productFit: ProductSupplyFit
  decisionChain: DecisionChain
  contactStrategy: ContactStrategy
  winningStrategy: WinningStrategy
  risk: RiskAssessment
  resource: ResourceAllocation
  nextActions: NextAction[]
}

export const BRIEF_VERSION = 1
