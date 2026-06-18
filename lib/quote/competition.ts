/**
 * Competition inference (Quote Intelligence P1 #6).
 *
 * A WEAK, transparent inference of competition intensity + price-comparing
 * likelihood from the customs/supplier signals we already store (how many
 * distinct suppliers the customer uses) plus their price positioning.
 *
 * This is only a fallback: an explicit salesperson annotation always wins.
 * Multi-sourcing (many suppliers) ⇒ more competitive / likely comparing prices;
 * single-sourcing ⇒ stickier ⇒ weaker competition.
 */
import type { CompetitionLevel, QuoteFactor } from '@/lib/quote/engine'

export interface CompetitionInferenceInput {
  supplierHints?: (string | null | undefined)[] | null      // companies.current_supplier_hints
  customsSupplierHints?: (string | null | undefined)[] | null // source_raw.customs.supplierHints
  hasCustomsHistory?: boolean | null
  pricePoint?: string | null
}

export interface CompetitionInference {
  competitionLevel: CompetitionLevel | null
  isPriceComparing: boolean | null
  supplierCount: number
  factors: QuoteFactor[]
  note: string
}

const LEVEL_ORDER: CompetitionLevel[] = ['weak', 'normal', 'strong', 'extreme']
function bump(level: CompetitionLevel, by: number): CompetitionLevel {
  const idx = LEVEL_ORDER.indexOf(level)
  return LEVEL_ORDER[Math.max(0, Math.min(LEVEL_ORDER.length - 1, idx + by))]
}

export function inferCompetition(i: CompetitionInferenceInput): CompetitionInference {
  const factors: QuoteFactor[] = []
  const all = [...(i.supplierHints ?? []), ...(i.customsSupplierHints ?? [])]
    .map((s) => String(s ?? '').trim().toLowerCase())
    .filter(Boolean)
  const supplierCount = new Set(all).size

  let level: CompetitionLevel | null = null
  let isPriceComparing: boolean | null = null

  if (supplierCount >= 5) {
    level = 'strong'; isPriceComparing = true
    factors.push({ label: '海关供应商数', effect: 'bad', note: `约 ${supplierCount} 家供应商 → 多源采购，竞争强、很可能比价` })
  } else if (supplierCount >= 3) {
    level = 'normal'; isPriceComparing = true
    factors.push({ label: '海关供应商数', effect: 'neutral', note: `约 ${supplierCount} 家供应商 → 中等竞争，可能比价` })
  } else if (supplierCount === 2) {
    level = 'normal'; isPriceComparing = null
    factors.push({ label: '海关供应商数', effect: 'neutral', note: '约 2 家供应商 → 中等竞争' })
  } else if (supplierCount === 1) {
    level = 'weak'; isPriceComparing = false
    factors.push({ label: '海关供应商数', effect: 'good', note: '单一供应商 → 黏性较强、竞争弱（切入需差异化）' })
  } else {
    factors.push({ label: '海关供应商数', effect: 'neutral', note: '无供应商线索 → 无法推断竞争（建议人工标注或查海关）' })
  }

  // Price positioning nudges the inference.
  const pp = (i.pricePoint ?? '').toLowerCase()
  if (pp === 'budget' || pp === 'low') {
    isPriceComparing = true
    level = level ? bump(level, 1) : 'strong'
    if (level === 'extreme') level = 'strong' // inference caps at 'strong'; 'extreme' is a manual call
    factors.push({ label: '价位', effect: 'bad', note: '低价导向 → 对价格敏感、竞争更激烈' })
  } else if (pp === 'premium' || pp === 'luxury') {
    if (level === 'strong') level = 'normal'
    if (isPriceComparing !== false) isPriceComparing = false
    factors.push({ label: '价位', effect: 'good', note: '高端定位 → 看重品质而非最低价' })
  }

  const note = level
    ? `推断竞争强度=${level}${isPriceComparing === true ? ' · 可能比价' : isPriceComparing === false ? ' · 比价可能性低' : ''}（基于 ${supplierCount} 家供应商线索${pp ? ' + 价位' : ''}）`
    : '竞争线索不足，未推断'

  return { competitionLevel: level, isPriceComparing, supplierCount, factors, note }
}
