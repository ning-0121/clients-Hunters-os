/**
 * loadPoCards — the PO engine's data plumbing. Reuses the verified loadOpps()
 * signal set, adds the one signal it lacks (supplier presence → R_SUPPLY) and
 * category (message personalization), maps into PoSignals, recalibrates weights
 * from real outcomes, scores, and returns Action Cards sorted DESC by PO_SCORE.
 * No new schema. `oppsToSignals` is exported so the /today stream reuses it.
 */
import { createDirectClient } from '@/lib/supabase/server'
import { loadOpps } from '@/lib/sales/load-opps'
import { poScore, type PoSignals, type PoCard } from '@/lib/sales/po-score'
import { deriveOutcome, calibrateWeights, type LearningReport } from '@/lib/sales/po-learn'
import type { Opp } from '@/lib/sales/revenue-os'

export interface PoEngineResult {
  cards: PoCard[]
  learning: LearningReport
}

const SAMPLE_SENT_STAGES = new Set(['sample_sent', 'quotation', 'trial_order', 'scale_order'])

/** Map opps → PoSignals (index-aligned with the input). Shared by loadPoCards + the /today stream. */
export async function oppsToSignals(opps: Opp[]): Promise<PoSignals[]> {
  const sb = createDirectClient()
  const ids = opps.map((o) => o.companyId)
  const { data: cos } = await sb.from('companies').select('id,source_raw,current_supplier_hints').in('id', ids)
  const supplyById: Record<string, 'gap' | 'stable' | 'unknown'> = {}
  const catById: Record<string, string | null> = {}
  for (const c of (cos as any[]) || []) {
    const sr = (c.source_raw ?? {}) as any
    const hasSupplier =
      (Array.isArray(sr.importYeti?.suppliers) && sr.importYeti.suppliers.length > 0) ||
      (Array.isArray(c.current_supplier_hints) && c.current_supplier_hints.length > 0) ||
      (Array.isArray(sr.customs?.supplierHints) && sr.customs.supplierHints.length > 0)
    const hasCustoms = !!(sr.importYeti?.totalShipments || sr.hqAddress || sr.customs?.snippets?.length)
    supplyById[c.id] = hasSupplier ? 'stable' : hasCustoms ? 'gap' : 'unknown'
    catById[c.id] = (Array.isArray(sr.product_categories) && sr.product_categories[0]) || sr.category || null
  }

  return opps.map((o): PoSignals => {
    const ages = [o.replyAgeDays, o.outreachSentAgeDays, o.sampleSentAgeDays, o.quoteSentAgeDays].filter(
      (x): x is number => x != null,
    )
    const lastTouchDays = ages.length ? Math.min(...ages) : null
    return {
      companyId: o.companyId,
      brand: o.brand,
      stage: o.stage,
      dmName: o.dmName ?? null,
      category: catById[o.companyId] ?? null,
      replied: o.replyAgeDays != null,
      sampleRequested: o.stage === 'sample_requested',
      hasQuoteHistory: o.quoteSentAgeDays != null,
      buyingSignal: o.poDiscussionActive,
      customerTypeMatch: true, // loadOpps universe is ICP-qualified
      poValueUsd: o.poValueUsd,
      lastTouchDays,
      emailVerified: o.reachability === 'R1',
      responseHistory: o.replyAgeDays != null,
      sampleSent: o.sampleSentAgeDays != null || SAMPLE_SENT_STAGES.has(o.stage),
      quoteExpired: o.quoteSentAgeDays != null && o.quoteSentAgeDays > 30,
      supply: supplyById[o.companyId] ?? 'unknown',
      replyAgeDays: o.replyAgeDays,
      hasAnyContact: o.reachability !== 'R3',
      enrichmentUncertain: o.reachability === 'R2',
      hasNextAction: o.hasNextAction,
    }
  })
}

export async function loadPoCards(): Promise<PoEngineResult> {
  const opps = await loadOpps()
  if (!opps.length) return { cards: [], learning: calibrateWeights([]) }
  const signals = await oppsToSignals(opps)
  const outcomes = signals.map(deriveOutcome).filter((o): o is NonNullable<typeof o> => o != null)
  const learning = calibrateWeights(outcomes)
  const cards = signals.map((s) => poScore(s, learning.weights)).sort((a, b) => b.poScore - a.poScore)
  return { cards, learning }
}
