/**
 * Account Progress Model — two orthogonal metrics, per the operating mandate.
 *
 *   Coverage Score   — intelligence DEPTH (how well we know the account).
 *   Progress Stage   — revenue PROGRESSION (how far the deal has moved).
 *
 * They are tracked SEPARATELY and never collapsed into one number. A founder
 * brand can be 100% covered (we know everyone who decides) yet still sit at
 * stage 2 (Reachable) because no one has replied. Coverage is what we know;
 * Progress is what has happened.
 *
 * Core rules baked in:
 *   - Founder-aware coverage: a founder-led company is FULLY covered once the
 *     decision makers that ACTUALLY EXIST are identified. We never penalize a
 *     small brand for missing an enterprise role (Sourcing Director, COO) that
 *     the org simply doesn't have.
 *   - Reachable ≠ Captured. Reachable (stage 2) only means contactable.
 *     Capture begins at engagement — reply / meeting / sample req / quote req
 *     — which is stage 3 (Connected) and up. isCaptured() reflects this.
 *   - Prioritize by Coverage × P(reaching the next stage). The objective is
 *     not finding contacts; it is moving accounts Reachable → Connected →
 *     Qualified → Sample → Quote → PO.
 */

export const PROGRESS_STAGES = [
  'Found',        // 1 — in the system
  'Reachable',    // 2 — we hold a reachable channel to a DM (NOT captured)
  'Connected',    // 3 — engagement: reply / meeting / sample req / quote req
  'Qualified',    // 4 — confirmed fit + intent
  'Sample Sent',  // 5
  'Quote Sent',   // 6
  'Opportunity',  // 7 — live deal
  'PO Received',  // 8 — revenue
] as const
export type ProgressStageName = (typeof PROGRESS_STAGES)[number]
/** Stage number (1-8) → name. */
export const stageName = (n: number): ProgressStageName =>
  PROGRESS_STAGES[Math.max(1, Math.min(8, n)) - 1]

/** Capture begins at Connected (3). Reachable (2) is contactable, not captured. */
export const isCaptured = (stage: number): boolean => stage >= 3

// ── Coverage Score ──────────────────────────────────────────────────────────

export type RoleType = 'founder' | 'sourcing' | 'production' | 'product' | 'other'

export interface ContactLite {
  roleType: RoleType
  isDecisionMaker: boolean
  /** true if we hold a verified/trusted email OR a LinkedIn URL. */
  reachable: boolean
}

export interface CoverageInput {
  contacts: ContactLite[]
  /** Do we have supplier / customs / sourcing-footprint intelligence? */
  hasSupplierIntel: boolean
  /** Do we know category? wedge? customer type? (0..3 of those). */
  accountFactsKnown: number
}

export interface CoverageBreakdown {
  committee: number   // 0-100, founder-aware
  contact: number     // 0-100, channels on identified DMs
  supplier: number    // 0-100
  account: number     // 0-100
  score: number       // 0-100 weighted
}

const W = { committee: 0.4, contact: 0.3, supplier: 0.15, account: 0.15 }

/**
 * Founder-aware committee coverage. The question is "have we identified the
 * people who actually decide at THIS company" — not "did we fill 5 fixed
 * enterprise slots." A founder + any one buying role is a complete small-brand
 * committee (100). A founder alone is a founder-led company where the founder
 * IS the buyer (75 — strong, but an ops/production contact would harden it).
 */
export function committeeCoverage(contacts: ContactLite[]): number {
  const hasFounder = contacts.some((c) => c.roleType === 'founder')
  const buying = new Set(
    contacts.filter((c) => c.roleType === 'sourcing' || c.roleType === 'production' || c.roleType === 'product').map((c) => c.roleType),
  )
  if (hasFounder && buying.size >= 1) return 100
  if (hasFounder) return 75
  if (buying.size >= 2) return 90
  if (buying.size >= 1) return 55
  return 0
}

export function computeCoverage(input: CoverageInput): CoverageBreakdown {
  const committee = committeeCoverage(input.contacts)
  const dms = input.contacts.filter((c) => c.isDecisionMaker || c.roleType !== 'other')
  const contact = dms.length ? Math.round((dms.filter((c) => c.reachable).length / dms.length) * 100) : 0
  const supplier = input.hasSupplierIntel ? 100 : 0
  const account = Math.round((Math.min(3, Math.max(0, input.accountFactsKnown)) / 3) * 100)
  const score = Math.round(committee * W.committee + contact * W.contact + supplier * W.supplier + account * W.account)
  return { committee, contact, supplier, account, score }
}

// ── Progress Stage (data-derived) ─────────────────────────────────────────────

export interface StageSignals {
  hasReachableDM: boolean
  /** engagement — any of: reply, meeting, sample request, quote request. */
  engaged: boolean
  qualified: boolean
  sampleSent: boolean
  quoteSent: boolean
  opportunity: boolean
  poReceived: boolean
}

/** Highest stage whose evidence is present. Never inferred upward without data. */
export function deriveStage(s: StageSignals): number {
  if (s.poReceived) return 8
  if (s.opportunity) return 7
  if (s.quoteSent) return 6
  if (s.sampleSent) return 5
  if (s.qualified) return 4
  if (s.engaged) return 3
  if (s.hasReachableDM) return 2
  return 1
}

// ── Priority = Coverage × P(next stage) ───────────────────────────────────────

/**
 * P(reaching the next stage), 0-100. Heuristic, evidence-anchored:
 *   - Reachable→Connected is gated by how likely the account replies if
 *     contacted — proxied by the sample-probability signal (engage intent).
 *   - Later transitions use declining base rates (each step is harder).
 * Returns 0 at the terminal stage (nothing further to reach).
 */
export function pNextStage(stage: number, engageProb0to100: number): number {
  switch (stage) {
    case 1: return 95               // Found→Reachable (we usually can reach)
    case 2: return Math.round(engageProb0to100) // Reachable→Connected
    case 3: return 60               // Connected→Qualified
    case 4: return 55               // Qualified→Sample
    case 5: return 45               // Sample→Quote
    case 6: return 40               // Quote→Opportunity
    case 7: return 35               // Opportunity→PO
    default: return 0               // PO — terminal
  }
}

/** Coverage × P(next), normalized to 0-100. Drives the worklist order. */
export function accountPriority(coverageScore: number, pNext: number): number {
  return Math.round((coverageScore / 100) * pNext)
}
