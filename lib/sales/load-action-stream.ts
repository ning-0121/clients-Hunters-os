/**
 * loadActionStream — the /today feed. Runs the closed loop (score → outcome →
 * recalibrate) and returns ONE ranked Action Card stream plus three collapsed
 * lanes. Reuses loadOpps + oppsToSignals + poScore + calibrateWeights so the
 * stream and the po-engine script score identically.
 */
import { loadOpps } from '@/lib/sales/load-opps'
import { oppsToSignals } from '@/lib/sales/load-po-cards'
import { poScore } from '@/lib/sales/po-score'
import { deriveOutcome, calibrateWeights, type LearningReport } from '@/lib/sales/po-learn'
import { toActionCard, buildSituation, type ActionCard } from '@/lib/sales/action-card'
import { loadStrategies } from '@/lib/sales/load-strategies'
import { selectStrategy, segmentForValue, type StrategyUnit } from '@/lib/sales/strategy'

export interface ActionStream {
  stream: ActionCard[] // primary — ranked by PO_SCORE desc
  lowRisk: ActionCard[] // collapsed — LOW risk, bulk-approvable
  stuck: ActionCard[] // collapsed — long silence / stale
  blocked: ActionCard[] // collapsed — no reachable contact
  learning: LearningReport
  strategies: StrategyUnit[] // live-scored strategy catalog (Strategy OS)
  total: number
}

export async function loadActionStream(): Promise<ActionStream> {
  const [opps, strategies] = await Promise.all([loadOpps(), loadStrategies()])
  if (!opps.length) {
    return { stream: [], lowRisk: [], stuck: [], blocked: [], learning: calibrateWeights([]), strategies, total: 0 }
  }
  const signals = await oppsToSignals(opps)
  const outcomes = signals.map(deriveOutcome).filter((o): o is NonNullable<typeof o> => o != null)
  const learning = calibrateWeights(outcomes)

  // Event → Strategy Selection (vector cosine match) → Action.
  const scored = opps.map((o, i) => {
    const situation = buildSituation(o)
    const strategy = selectStrategy(situation, strategies, segmentForValue(o.poValueUsd))
    return { o, ac: toActionCard(o, poScore(signals[i], learning.weights), strategy, situation) }
  })
  const nonBlocked = scored.filter((x) => !x.ac.blocked).sort((a, b) => b.ac.poScore - a.ac.poScore)

  const stream = nonBlocked.map((x) => x.ac)
  const lowRisk = nonBlocked.filter((x) => x.ac.riskLevel === 'LOW').map((x) => x.ac)
  const stuck = nonBlocked
    .filter((x) => (x.o.outreachSentAgeDays ?? 0) > 14 || (x.o.replyAgeDays ?? 0) > 30)
    .map((x) => x.ac)
  const blocked = scored
    .filter((x) => x.ac.blocked)
    .sort((a, b) => b.ac.poImpactUsd - a.ac.poImpactUsd)
    .map((x) => x.ac)

  return { stream, lowRisk, stuck, blocked, learning, strategies, total: scored.length }
}
