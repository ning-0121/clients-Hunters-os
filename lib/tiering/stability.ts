/**
 * Tiering stability — keep a strategic account from flipping A↔D on LLM scoring noise.
 *
 * The tiering dimensions come from an LLM (temperature > 0), so a re-score can
 * nudge e.g. strategic_value 7→6, which crosses naturalTier's A threshold and
 * collapses the account to D. That is unacceptable for a strategic account.
 *
 * Rule: when a company already has a dimension score, only adopt a NEW value if it
 * moves by at least STABILITY_DELTA points; otherwise keep the existing value.
 * Small (±1) noise is ignored; genuine large shifts still go through.
 */
export const STABILITY_DELTA = 2

export interface StableDims {
  customerScaleScore: number
  productMatchScore: number
  conversionFeasibilityScore: number
  strategicValueScore: number
  paymentRiskScore: number
}

/** Keep `oldV` unless the new value moved by ≥ delta (then adopt it). */
export function stabilizeScore(oldV: number | null | undefined, newV: number, delta = STABILITY_DELTA): number {
  if (oldV == null || Number.isNaN(oldV)) return newV
  return Math.abs(newV - oldV) < delta ? oldV : newV
}

/** Stabilize each numeric tiering dimension against the company's existing values. */
export function stabilizeDims(oldD: Partial<StableDims> | null | undefined, newD: StableDims, delta = STABILITY_DELTA): StableDims {
  const o = oldD ?? {}
  return {
    customerScaleScore:         stabilizeScore(o.customerScaleScore, newD.customerScaleScore, delta),
    productMatchScore:          stabilizeScore(o.productMatchScore, newD.productMatchScore, delta),
    conversionFeasibilityScore: stabilizeScore(o.conversionFeasibilityScore, newD.conversionFeasibilityScore, delta),
    strategicValueScore:        stabilizeScore(o.strategicValueScore, newD.strategicValueScore, delta),
    paymentRiskScore:           stabilizeScore(o.paymentRiskScore, newD.paymentRiskScore, delta),
  }
}

/** Has this company already been tiered (i.e. are there existing dims to preserve)? */
export function hasExistingDims(c: {
  customer_scale_score?: number | null
  product_match_score?: number | null
  strategic_value_score?: number | null
  conversion_feasibility_score?: number | null
}): boolean {
  return [c.customer_scale_score, c.product_match_score, c.strategic_value_score, c.conversion_feasibility_score]
    .some((v) => typeof v === 'number')
}

/**
 * Is this a high-value account for the coverage-report denominator?
 * Robust to a single noisy re-score: counts a recomputed natural-A OR a stored
 * customer_tier of A, so one LLM rerun can't collapse the denominator to zero.
 */
export function isHighValueAccount(naturalTier: string, storedTier?: string | null): boolean {
  return naturalTier === 'A' || storedTier === 'A'
}
