/**
 * Per-category pricing baselines for the Quote Intelligence Engine.
 *
 * Mirrors lib/config.ts: gracefully falls back to in-code defaults if the
 * `pricing_config` table / migration 010 is not yet applied — so the engine and
 * the strategy card render meaningful (clearly-labelled) numbers immediately.
 *
 * The four-margin ladder invariant (enforced by the engine, seeded here):
 *     strategic_margin ≤ floor_margin ≤ recommended_margin ≤ target_margin
 *
 * `needs_real_cost = true` means the value is a STARTING baseline — the owner
 * must confirm real cost before the margins can be trusted (avoids the
 * "garbage in, garbage out" failure mode called out in the design doc).
 */
import { createDirectClient } from '@/lib/supabase/server'

export type QuoteCategory =
  | 'leggings' | 'flare' | 'sports_bra' | 'jacket' | 'hoodie' | 'shorts' | 'activewear_set'

export type FabricComplexity = 'low' | 'medium' | 'high'

/**
 * Fabric MATERIAL — the dominant driver of fabric cost. Distinct from
 * fabricComplexity (which is a production-risk signal). Multipliers are relative
 * to poly/spandex (the cheapest common performance fabric = 1.0). These are
 * defensible industry estimates, NOT confirmed costs — see needsRealCost.
 */
export type FabricMaterial = 'poly_spandex' | 'nylon_spandex' | 'cotton' | 'fleece' | 'seamless'

export const MATERIAL_MULT: Record<FabricMaterial, number> = {
  poly_spandex: 1.00,   // 涤纶/氨纶 — baseline, most activewear
  nylon_spandex: 1.30,  // 锦纶/氨纶 — pricier yarn, premium hand-feel (Nulu-type)
  cotton: 1.12,         // 棉/有机棉 — organic certified runs higher
  fleece: 1.22,         // 抓绒/卫衣布 — heavier GSM, more yarn
  seamless: 1.45,       // 无缝 — seamless knit machine, slower throughput
}

export const FABRIC_MATERIAL_LABELS: Record<FabricMaterial, string> = {
  poly_spandex: '涤纶/氨纶 (Poly/Spandex)',
  nylon_spandex: '锦纶/氨纶 (Nylon/Spandex)',
  cotton: '棉/有机棉 (Cotton)',
  fleece: '抓绒/卫衣布 (Fleece)',
  seamless: '无缝 (Seamless)',
}

/** Plus-size: more fabric + grading + sometimes reinforced panels. */
export const PLUS_SIZE_MULT = 1.15

export interface PricingBaseline {
  category: QuoteCategory
  label: string
  baseCostIndex: number       // per-unit baseline cost (USD or index)
  complexityFactor: number    // category fabric/process complexity multiplier
  devCost: number             // one-time sampling/pattern cost (USD), amortized over qty
  moq: number
  targetMargin: number        // 0-1 anchor "good outcome"
  recommendedMargin: number   // 0-1 default recommended start
  floorMargin: number         // 0-1 HARD red line (normal customers)
  strategicMargin: number     // 0-1 absolute red line (strategic + owner approval only)
  needsRealCost: boolean
}

/** In-code defaults — identical to the seed in migration 010. */
export const DEFAULT_PRICING: Record<QuoteCategory, PricingBaseline> = {
  leggings:       { category: 'leggings',       label: 'Leggings 瑜伽裤',        baseCostIndex: 4.2,  complexityFactor: 1.0,  devCost: 80,  moq: 50, targetMargin: 0.30, recommendedMargin: 0.24, floorMargin: 0.16, strategicMargin: 0.08, needsRealCost: true },
  flare:          { category: 'flare',          label: 'Flare 喇叭裤',           baseCostIndex: 4.6,  complexityFactor: 1.05, devCost: 85,  moq: 50, targetMargin: 0.30, recommendedMargin: 0.24, floorMargin: 0.16, strategicMargin: 0.08, needsRealCost: true },
  sports_bra:     { category: 'sports_bra',     label: 'Sports Bra 运动内衣',     baseCostIndex: 3.0,  complexityFactor: 1.1,  devCost: 90,  moq: 50, targetMargin: 0.32, recommendedMargin: 0.26, floorMargin: 0.17, strategicMargin: 0.09, needsRealCost: true },
  jacket:         { category: 'jacket',         label: 'Jacket 外套',            baseCostIndex: 11.0, complexityFactor: 1.3,  devCost: 150, moq: 50, targetMargin: 0.28, recommendedMargin: 0.22, floorMargin: 0.15, strategicMargin: 0.07, needsRealCost: true },
  hoodie:         { category: 'hoodie',         label: 'Hoodie 卫衣',            baseCostIndex: 7.5,  complexityFactor: 1.1,  devCost: 100, moq: 50, targetMargin: 0.30, recommendedMargin: 0.24, floorMargin: 0.16, strategicMargin: 0.08, needsRealCost: true },
  shorts:         { category: 'shorts',         label: 'Shorts 短裤',            baseCostIndex: 3.8,  complexityFactor: 0.9,  devCost: 70,  moq: 50, targetMargin: 0.28, recommendedMargin: 0.22, floorMargin: 0.15, strategicMargin: 0.07, needsRealCost: true },
  activewear_set: { category: 'activewear_set', label: 'Activewear Set 运动套装', baseCostIndex: 9.0,  complexityFactor: 1.2,  devCost: 160, moq: 50, targetMargin: 0.31, recommendedMargin: 0.25, floorMargin: 0.17, strategicMargin: 0.09, needsRealCost: true },
}

export const QUOTE_CATEGORIES: QuoteCategory[] = Object.keys(DEFAULT_PRICING) as QuoteCategory[]

export const FABRIC_COMPLEXITY_LABELS: Record<FabricComplexity, string> = {
  low: '简单（基础面料/工艺）',
  medium: '中等',
  high: '复杂（特殊面料/高工艺）',
}

function isCategory(x: unknown): x is QuoteCategory {
  return typeof x === 'string' && x in DEFAULT_PRICING
}

function rowToBaseline(row: Record<string, unknown>): PricingBaseline | null {
  if (!isCategory(row.category)) return null
  const d = DEFAULT_PRICING[row.category]
  const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)
  return {
    category: row.category,
    label: typeof row.label === 'string' && row.label ? row.label : d.label,
    baseCostIndex: num(row.base_cost_index, d.baseCostIndex),
    complexityFactor: num(row.complexity_factor, d.complexityFactor),
    devCost: num(row.dev_cost, d.devCost),
    moq: num(row.moq, d.moq),
    targetMargin: num(row.target_margin, d.targetMargin),
    recommendedMargin: num(row.recommended_margin, d.recommendedMargin),
    floorMargin: num(row.floor_margin, d.floorMargin),
    strategicMargin: num(row.strategic_margin, d.strategicMargin),
    needsRealCost: row.needs_real_cost === null || row.needs_real_cost === undefined ? d.needsRealCost : !!row.needs_real_cost,
  }
}

/**
 * Load the full pricing config (DB row overrides default per category).
 * Always returns all categories — DB-missing ones fall back to defaults.
 */
export async function getPricingConfig(): Promise<Record<QuoteCategory, PricingBaseline>> {
  const merged: Record<QuoteCategory, PricingBaseline> = { ...DEFAULT_PRICING }
  try {
    const sb = createDirectClient()
    const { data, error } = await sb.from('pricing_config').select('*')
    if (error || !data) return merged
    for (const row of data) {
      const b = rowToBaseline(row as Record<string, unknown>)
      if (b) merged[b.category] = b
    }
    return merged
  } catch {
    return merged
  }
}

/** Single-category baseline (DB override or default). */
export async function getPricingBaseline(category: QuoteCategory): Promise<PricingBaseline> {
  const cfg = await getPricingConfig()
  return cfg[category] ?? DEFAULT_PRICING[category]
}
