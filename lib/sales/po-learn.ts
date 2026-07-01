/**
 * ================= SELF-LEARNING CORE (OUTCOME → MODEL UPDATE) =================
 * Closes the loop: real outcomes recalibrate the PO_SCORE weights (spec §8/§9).
 *
 * Design: weights are a DETERMINISTIC function of the accumulated real outcomes,
 * recomputed on every load. No stored mutable model, no migration, no drift —
 * as real replies/samples/POs accrue, the weights move on their own. With few
 * outcomes, shrinkage keeps them at the spec priors (never hallucinate a model).
 */
import { DEFAULT_WEIGHTS, type Weights, type PoSignals } from '@/lib/sales/po-score'

export const OUTCOME_TYPES = ['reply_received', 'sample_requested', 'quote_requested', 'po_created', 'no_response'] as const
export type ActionOutcome = (typeof OUTCOME_TYPES)[number]

/** Real outcome of the actions taken on an account so far (from live signals only). */
export function deriveOutcome(s: PoSignals): ActionOutcome | null {
  if (s.stage === 'trial_order' || s.stage === 'scale_order') return 'po_created'
  if (s.hasQuoteHistory || s.stage === 'quotation') return 'quote_requested'
  if (s.sampleRequested || s.sampleSent) return 'sample_requested'
  if (s.replied) return 'reply_received'
  if (s.lastTouchDays != null) return 'no_response' // outreach sent, no reply
  return null // never actioned → nothing to learn from yet
}

export interface LearningReport {
  weights: Weights
  counts: Record<ActionOutcome, number>
  total: number
  confidence: number // 0..1 shrinkage — how much the model trusts the observed data
  notes: string[]
}

const K = 20 // shrinkage constant: below ~K actioned outcomes, weights stay near priors
const clone = (w: Weights): Weights => JSON.parse(JSON.stringify(w))

/** Recalibrate weights from real outcomes, per spec §9 (bounded, shrinkage-scaled). */
export function calibrateWeights(outcomes: ActionOutcome[]): LearningReport {
  const counts: Record<ActionOutcome, number> = { reply_received: 0, sample_requested: 0, quote_requested: 0, po_created: 0, no_response: 0 }
  for (const o of outcomes) counts[o]++
  const total = outcomes.length
  const c = total ? total / (total + K) : 0
  const rate = (n: number) => (total ? n / total : 0)

  const w = clone(DEFAULT_WEIGHTS)
  const notes: string[] = []

  const engagedR = rate(counts.reply_received + counts.sample_requested + counts.quote_requested + counts.po_created)
  const sampleR = rate(counts.sample_requested + counts.po_created)
  const poR = rate(counts.po_created)
  const noR = rate(counts.no_response)

  if (counts.reply_received + counts.sample_requested + counts.quote_requested + counts.po_created > 0) {
    const bump = 1 + 0.3 * c * engagedR
    w.pPo.reply *= bump
    w.rResponse.recent *= bump
    w.rResponse.mid *= bump
    notes.push(`reply/engagement 观测 → P_PO.reply & R_RESPONSE ×${bump.toFixed(3)}`)
  }
  if (counts.sample_requested + counts.po_created > 0) {
    const bump = 1 + 0.3 * c * sampleR
    w.rSample.requested *= bump
    w.pPo.sample *= bump
    notes.push(`sample 观测 → R_SAMPLE.requested & P_PO.sample ×${bump.toFixed(3)}`)
  }
  if (counts.po_created > 0) {
    const bump = 1 + 0.6 * c * poR // "increase V_PO weight significantly"
    w.vPoMarginPct *= bump
    notes.push(`po_created 观测 → V_PO 权重 ×${bump.toFixed(3)}（显著）`)
  }
  if (counts.no_response > 0) {
    const fb = 1 + 0.3 * c * noR
    w.friction.missingNextAction *= fb
    w.friction.stale *= fb
    const decay = 1 - 0.2 * c * noR
    w.pPo.category *= decay
    w.pPo.buying *= decay
    notes.push(`no_response → FRICTION ×${fb.toFixed(3)}，弱信号(category/buying) ×${decay.toFixed(3)}`)
  }

  // sane clamps
  w.friction.missingNextAction = Math.min(0.4, w.friction.missingNextAction)
  w.friction.stale = Math.min(0.4, w.friction.stale)
  w.rResponse.recent = Math.min(3, w.rResponse.recent)
  w.rSample.requested = Math.min(2.5, w.rSample.requested)
  w.vPoMarginPct = Math.min(0.5, w.vPoMarginPct)

  if (total === 0) notes.push('⚠ 无任何执行结果 → 100% 使用先验权重（无可学习数据）')
  else if (c < 0.3) notes.push(`结果样本少(${total}) → 置信 ${Math.round(c * 100)}%，权重仅轻微偏离先验`)

  return { weights: w, counts, total, confidence: +c.toFixed(2), notes }
}
