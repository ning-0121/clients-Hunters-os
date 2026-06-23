/**
 * Quote Intelligence Engine V1.1 — P0 (DECISION SUPPORT, not auto-quoting).
 *
 * A zero-cost, rule-based, fully-explainable pure function. Like the tiering /
 * credit engines, every number can be opened up to see "why". An LLM is NOT
 * used here (P1 only polishes the recommendation into customer-facing copy).
 *
 * HARD CONSTRAINTS baked in (the system is a recommender, never an executor):
 *   1. Every output is a *recommendation* — see `disclaimer`. Nothing is sent.
 *   2. Margin ladder invariant:  strategic ≤ floor ≤ recommended ≤ target.
 *   3. A quote below Floor Margin → requires OWNER APPROVAL (never auto-OK).
 *   4. Below Floor is only *unlocked at all* for strategic customers; for normal
 *      customers Floor is the hard red line.
 *   5. A quote below Strategic Margin → FORBIDDEN, always (engine won't propose).
 *   6. Sample policy is a recommendation; the system never promises a customer.
 *
 * CAC is NOT computed in P0 — only a reserved `cac` field is carried through.
 */
import type { PricingBaseline, FabricComplexity, FabricMaterial } from '@/lib/quote/pricing-config'
import { MATERIAL_MULT, PLUS_SIZE_MULT, FABRIC_MATERIAL_LABELS } from '@/lib/quote/pricing-config'

// ── Shared explainable-factor shape (matches lib/credit + lib/intent) ─────────
export interface QuoteFactor {
  label: string
  effect: 'good' | 'bad' | 'neutral'
  note: string
}

export interface ScoreResult {
  /** 0-100 */
  score: number
  factors: QuoteFactor[]
}

export type CustomerTier = 'A' | 'B' | 'C' | 'D'
export type CompetitionLevel = 'extreme' | 'strong' | 'normal' | 'weak'
export type SamplePolicyKind = 'free' | 'partial' | 'full'

/** Customers at/above this Strategic Value unlock the sub-floor strategic band. */
export const STRATEGIC_VALUE_THRESHOLD = 75

export interface QuoteEngineInput {
  // product / deal
  qty: number
  fabricComplexity: FabricComplexity
  fabricMaterial?: FabricMaterial | null   // drives fabric COST (锦纶/涤纶/棉/抓绒/无缝)
  plusSize?: boolean | null                // more fabric + grading → higher cost

  // customer signals (all optional — engine degrades gracefully)
  customerTier?: CustomerTier | null
  intentScore?: number | null            // 0-10
  productMatchScore?: number | null      // 0-10
  customerScaleScore?: number | null     // 0-10
  ltvPotentialScore?: number | null      // 0-10
  replyProbabilityScore?: number | null  // 0-10
  contactQualityScore?: number | null    // 0-10 (verified decision-maker = high)
  estimatedAnnualRevenue?: string | null
  targetCustomerSegment?: string | null
  country?: string | null
  instagramFollowers?: number | null
  tiktokFollowers?: number | null
  fundingDetected?: boolean | null
  newProductsDetected?: boolean | null

  // competition (salesperson annotation; P1 also infers from customs supplier count)
  isPriceComparing?: boolean | null
  competitionLevel?: CompetitionLevel | null
  /** Display-only provenance for the resolved competition signal (echoed to output). */
  competitionMeta?: CompetitionMeta

  // history (orders / samples — anti-freeloader)
  orderCount?: number | null
  hasRepeatOrder?: boolean | null
  sampleCount?: number | null
  unconvertedSampleCount?: number | null // sampled but never ordered

  // risk — reuse lib/credit/assess.ts output (0-10) as the primary input
  creditRiskScore?: number | null        // 0-10 (higher = riskier)
  creditBand?: string | null
  paymentRiskScore?: number | null       // 0-10 fallback if no credit assessment
}

export interface MarginLadder {
  strategic: number    // 0-1, absolute red line (strategic + owner approval only)
  floor: number        // 0-1, hard red line for normal customers
  recommended: number  // 0-1
  target: number       // 0-1
}

export interface PriceLadder {
  unitCost: number
  strategic: number
  floor: number
  recommended: number
  target: number
  /** Suggested opening range: settle toward `low`, open near `high`. */
  rangeLow: number
  rangeHigh: number
}

export type MarginStatus = 'ok' | 'owner_approval' | 'forbidden'

export interface MarginVerdict {
  status: MarginStatus
  reason: string
}

export interface NegotiationRule {
  label: string
  reason: string
}

export interface NegotiationRules {
  allow: NegotiationRule[]
  forbid: NegotiationRule[]
  warnings: string[]
}

export interface SampleDecision {
  policy: SamplePolicyKind
  reason: string
  /** Even a strategic free sample can need owner approval (cost is an investment). */
  requiresOwnerApproval: boolean
}

export interface QuoteExplanation {
  margin: string
  concession: string
  sample: string
  overall: string
}

/** Provenance of the competition signal used (P1 #6). Display-only. */
export interface CompetitionMeta {
  level: CompetitionLevel | null
  isPriceComparing: boolean | null
  source: 'manual' | 'stored' | 'inferred' | 'none'
  note: string
}

/** Where the unit cost came from + how much to trust it. Never claims real cost. */
export interface CostBasis {
  unitCost: number
  material: FabricMaterial
  materialLabel: string
  materialMult: number
  plusSize: boolean
  /** 'low' = system default baseline (estimate), 'high' = owner-confirmed in pricing_config. */
  confidence: 'low' | 'high'
  /** Human breakdown of how unitCost was derived. */
  breakdown: string
  /** Plain-language source + caveat. */
  source: string
}

export interface QuoteStrategy {
  category: PricingBaseline['category']
  categoryLabel: string
  qty: number
  fabricComplexity: FabricComplexity
  fabricMaterial: FabricMaterial
  plusSize: boolean
  costBasis: CostBasis

  scores: {
    pricing: ScoreResult
    dealValue: ScoreResult
    winProbability: ScoreResult
    risk: ScoreResult
    strategicValue: ScoreResult
  }

  margins: MarginLadder
  prices: PriceLadder

  isStrategicCustomer: boolean
  /** True when a sub-floor strategic band is unlocked → using it needs owner approval. */
  requiresOwnerApproval: boolean
  strategicNote: string | null

  /** Where the competition signal came from (P1 #6). Set by the action wrapper. */
  competition?: CompetitionMeta

  samplePolicy: SampleDecision
  negotiation: NegotiationRules
  explanation: QuoteExplanation

  /** RESERVED — CAC is not computed in P0. */
  cac: null
  needsRealCost: boolean
  /** This is advice, not an action. */
  disclaimer: string
  /** Stable label asserting the non-automated nature of the output. */
  kind: 'recommendation'
}

// ── helpers ───────────────────────────────────────────────────────────────────
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))
const clamp100 = (n: number) => clamp(Math.round(n), 0, 100)
const norm10 = (v?: number | null) => (typeof v === 'number' && Number.isFinite(v) ? clamp(v, 0, 10) / 10 : null)
/** margin → "18.0%" */
export const pct = (m: number) => `${(Math.round(m * 1000) / 10).toFixed(1)}%`
/** money → 2dp number */
const money = (n: number) => Math.round(n * 100) / 100

const COMPETITION_PENALTY: Record<CompetitionLevel, number> = { extreme: 0.04, strong: 0.025, normal: 0, weak: -0.01 }

/**
 * Unit cost from EVIDENCE-shaped inputs: category baseline × category complexity
 * × fabric MATERIAL × plus-size, plus amortized dev cost. Material (锦纶/涤纶/棉/
 * 抓绒/无缝) is the dominant driver — the old model ignored it. We return the full
 * breakdown + a confidence so the salesperson can judge usability, and we never
 * present a default baseline as a confirmed cost.
 */
function computeCostBasis(b: PricingBaseline, qty: number, material: FabricMaterial, plusSize: boolean): CostBasis {
  const mat = MATERIAL_MULT[material]
  const plus = plusSize ? PLUS_SIZE_MULT : 1
  const make = b.baseCostIndex * b.complexityFactor * mat * plus
  const dev = b.devCost / Math.max(qty, 1)
  const unitCost = money(make + dev)
  const confidence: 'low' | 'high' = b.needsRealCost ? 'low' : 'high'
  const breakdown =
    `基准 $${b.baseCostIndex} × 类目系数 ${b.complexityFactor} × 面料 ${mat}(${FABRIC_MATERIAL_LABELS[material]})` +
    `${plusSize ? ` × 加大码 ${PLUS_SIZE_MULT}` : ''} = 制造 $${money(make)} + 开发摊销 $${money(dev)}/件（${qty} 件）`
  const source = confidence === 'high'
    ? 'pricing_config 已确认真实成本'
    : '系统默认基准 × 面料系数（估算，未经 pricing_config 核实真实成本）'
  return { unitCost, material, materialLabel: FABRIC_MATERIAL_LABELS[material], materialMult: mat, plusSize, confidence, breakdown, source }
}

function revenueScore(s?: string | null): { add: number; note: string } {
  if (!s) return { add: 12, note: '营收未知（中性取值）' }
  const t = s.replace(/\s/g, '')
  if (/B|billion|>\$?\d{4,}M/i.test(t)) return { add: 40, note: `营收 ${s}（十亿级，单值高）` }
  if (/\$?\d{3,}M/i.test(t)) return { add: 32, note: `营收 ${s}（亿级）` }
  if (/\$?\d{2}M/i.test(t)) return { add: 22, note: `营收 ${s}（千万级）` }
  if (/\$?\d{1}M|\$?\d{3,}K/i.test(t)) return { add: 12, note: `营收 ${s}（百万级）` }
  return { add: 6, note: `营收 ${s}（规模有限）` }
}

const STRATEGIC_SEGMENTS = /retailer_chain|importer|agency|supplier_portal/i
const BRAND_SEGMENTS = /brand_owner|dtc/i

// ── ① Pricing Score — 定价权（我能报多高） ─────────────────────────────────────
function scorePricing(i: QuoteEngineInput): ScoreResult {
  const f: QuoteFactor[] = []
  let s = 45
  const pm = norm10(i.productMatchScore)
  if (pm !== null) {
    const add = pm * 20
    s += add
    f.push({ label: '产品匹配独特性', effect: pm >= 0.6 ? 'good' : 'neutral', note: `匹配度 ${(pm * 10).toFixed(0)}/10${pm >= 0.6 ? '，可强调差异化、报高价' : ''}` })
  }
  const intent = norm10(i.intentScore)
  if (intent !== null && intent >= 0.6) { s += intent * 12; f.push({ label: '客户意图', effect: 'good', note: `意图 ${(intent * 10).toFixed(0)}/10，急需→议价空间大` }) }

  if (i.isPriceComparing) { s -= 18; f.push({ label: '客户在比价', effect: 'bad', note: '明确比价 → 定价权下降，留谈判空间' }) }
  if (i.competitionLevel === 'weak') { s += 12; f.push({ label: '弱竞争', effect: 'good', note: '竞争弱 → 可报高价' }) }
  else if (i.competitionLevel === 'strong') { s -= 12; f.push({ label: '强竞争', effect: 'bad', note: '竞争强 → 定价权受限' }) }
  else if (i.competitionLevel === 'extreme') { s -= 18; f.push({ label: '极端竞争', effect: 'bad', note: '红海竞争 → 定价权很弱' }) }

  if (i.customerTier === 'A') { s += 10; f.push({ label: '客户等级 A', effect: 'good', note: 'A 级看重质量/合规而非最低价' }) }
  else if (i.customerTier === 'B') { s += 4 }
  else if (i.customerTier === 'C') { s -= 4 }
  else if (i.customerTier === 'D') { s -= 8; f.push({ label: '客户等级 D', effect: 'bad', note: '低价导向，难报高价' }) }

  return { score: clamp100(s), factors: f }
}

// ── ② Deal Value Score — 这单/这客户值多少 ─────────────────────────────────────
function scoreDealValue(i: QuoteEngineInput): ScoreResult {
  const f: QuoteFactor[] = []
  let s = 0
  const rev = revenueScore(i.estimatedAnnualRevenue)
  s += rev.add
  f.push({ label: '年营收', effect: rev.add >= 22 ? 'good' : 'neutral', note: rev.note })

  const ltv = norm10(i.ltvPotentialScore)
  if (ltv !== null) { s += ltv * 25; f.push({ label: '长期价值 LTV', effect: ltv >= 0.6 ? 'good' : 'neutral', note: `LTV 潜力 ${(ltv * 10).toFixed(0)}/10` }) }
  const scale = norm10(i.customerScaleScore)
  if (scale !== null) { s += scale * 15; f.push({ label: '客户规模', effect: scale >= 0.6 ? 'good' : 'neutral', note: `规模 ${(scale * 10).toFixed(0)}/10` }) }

  const intent = norm10(i.intentScore)
  if ((intent !== null && intent >= 0.6) || i.fundingDetected || i.newProductsDetected) {
    s += 12; f.push({ label: '增长潜力', effect: 'good', note: [i.fundingDetected && '近期融资', i.newProductsDetected && '上新产品线', intent && intent >= 0.6 && '高意图'].filter(Boolean).join(' · ') || '增长信号' })
  }
  if (i.hasRepeatOrder) { s += 8; f.push({ label: '复购历史', effect: 'good', note: '已有返单 → 客户价值确认' }) }

  return { score: clamp100(s), factors: f }
}

// ── ③ Win Probability — 成交概率 ────────────────────────────────────────────────
function scoreWinProbability(i: QuoteEngineInput): ScoreResult {
  const f: QuoteFactor[] = []
  let s = 30
  const intent = norm10(i.intentScore)
  if (intent !== null) { s += intent * 25; f.push({ label: '意图', effect: intent >= 0.6 ? 'good' : 'neutral', note: `意图 ${(intent * 10).toFixed(0)}/10` }) }
  const reply = norm10(i.replyProbabilityScore)
  if (reply !== null) { s += reply * 20; f.push({ label: '回复概率', effect: reply >= 0.5 ? 'good' : 'neutral', note: `回复概率 ${(reply * 100).toFixed(0)}%` }) }
  const cq = norm10(i.contactQualityScore)
  if (cq !== null) { s += cq * 15; f.push({ label: '联系人质量', effect: cq >= 0.6 ? 'good' : 'neutral', note: cq >= 0.6 ? '已验证关键决策人' : '联系人待验证' }) }

  if (i.competitionLevel === 'weak') { s += 12; f.push({ label: '竞争位置', effect: 'good', note: '弱竞争 → 易成交' }) }
  else if (i.competitionLevel === 'strong' || i.competitionLevel === 'extreme') { s -= 10; f.push({ label: '竞争位置', effect: 'bad', note: '强竞争 → 成交难度高' }) }
  if (i.isPriceComparing) { s -= 8; f.push({ label: '比价中', effect: 'bad', note: '客户比价 → 成交不确定' }) }

  if (i.hasRepeatOrder) { s += 10; f.push({ label: '存量关系', effect: 'good', note: '已有合作 → 成交概率高' }) }
  else if (i.customerTier === 'A' || i.customerTier === 'B') { s += 6 }
  else if (i.customerTier === 'D') { s -= 6 }

  return { score: clamp100(s), factors: f }
}

// ── ④ Risk Score — 风险（越高越危险）─────────────────────────────────────────────
function scoreRisk(i: QuoteEngineInput): ScoreResult {
  const f: QuoteFactor[] = []
  const creditBase = norm10(i.creditRiskScore) ?? norm10(i.paymentRiskScore) ?? 0.5
  let s = creditBase * 70 // credit/payment risk is the main driver (up to 70)
  f.push({
    label: '付款/信用风险',
    effect: creditBase <= 0.35 ? 'good' : creditBase <= 0.6 ? 'neutral' : 'bad',
    note: i.creditBand ? `信用评估：${i.creditBand}（${(creditBase * 10).toFixed(1)}/10）` : `信用风险 ${(creditBase * 10).toFixed(1)}/10`,
  })

  if (i.fabricComplexity === 'high') { s += 8; f.push({ label: '生产风险', effect: 'bad', note: '特殊面料/高工艺 → 打样与交付风险↑' }) }
  if ((i.qty ?? 0) > 0 && i.qty < 100) { s += 6; f.push({ label: '小批量', effect: 'bad', note: `数量 ${i.qty} 偏小 → 摊销开发成本压力` }) }

  const orderCount = i.orderCount ?? 0
  if (orderCount === 0) { s += 12; f.push({ label: '新客户', effect: 'bad', note: '无历史订单 → 建议首单预付' }) }
  if ((i.unconvertedSampleCount ?? 0) >= 2) { s += 8; f.push({ label: '取样未成交', effect: 'bad', note: `取样 ${i.unconvertedSampleCount} 次未下单 → 白嫖风险` }) }
  if (i.hasRepeatOrder) { s -= 10; f.push({ label: '良好合作史', effect: 'good', note: '有返单 → 风险下降' }) }

  return { score: clamp100(s), factors: f }
}

// ── ⑤ Strategic Value Score — 战略价值（独立于本单利润）──────────────────────────
function scoreStrategicValue(i: QuoteEngineInput): ScoreResult {
  const f: QuoteFactor[] = []
  let s = 0
  const seg = i.targetCustomerSegment ?? ''
  if (STRATEGIC_SEGMENTS.test(seg)) { s += 25; f.push({ label: '渠道价值', effect: 'good', note: `${seg} → 可打开渠道/带来更多客户` }) }
  else if (BRAND_SEGMENTS.test(seg)) { s += 10; f.push({ label: '渠道价值', effect: 'neutral', note: `${seg}` }) }

  const followers = (i.instagramFollowers ?? 0) + (i.tiktokFollowers ?? 0)
  if (followers >= 1_000_000) { s += 20; f.push({ label: '品牌价值', effect: 'good', note: `社媒 ${(followers / 1e6).toFixed(1)}M 粉 → 强背书/可做案例` }) }
  else if (followers >= 100_000) { s += 12; f.push({ label: '品牌价值', effect: 'good', note: `社媒 ${(followers / 1e3).toFixed(0)}k 粉` }) }
  else if (followers >= 10_000) { s += 5; f.push({ label: '品牌价值', effect: 'neutral', note: `社媒 ${(followers / 1e3).toFixed(0)}k 粉` }) }

  const intent = norm10(i.intentScore)
  if (i.fundingDetected) { s += 8; f.push({ label: '增长价值', effect: 'good', note: '近期融资 → 高速增长' }) }
  if (i.newProductsDetected) { s += 6; f.push({ label: '增长价值', effect: 'good', note: '上新产品线 → 扩张中' }) }
  else if (intent !== null && intent >= 0.6) { s += 6; f.push({ label: '增长价值', effect: 'good', note: '高意图 → 处于活跃增长期' }) }

  const ltv = norm10(i.ltvPotentialScore)
  if (ltv !== null) { s += ltv * 20; f.push({ label: '长期价值', effect: ltv >= 0.6 ? 'good' : 'neutral', note: `LTV 潜力 ${(ltv * 10).toFixed(0)}/10` }) }
  if (i.customerTier === 'A') { s += 12; f.push({ label: '战略账户', effect: 'good', note: 'A 级战略账户，长期培育价值高' }) }
  else if (i.customerTier === 'B') { s += 5 }

  return { score: clamp100(s), factors: f }
}

// ── Margin ladder ───────────────────────────────────────────────────────────────
function buildMargins(
  b: PricingBaseline,
  pricing: number, risk: number, winProb: number, dealValue: number, strategicValue: number,
  i: QuoteEngineInput,
): { margins: MarginLadder; isStrategicCustomer: boolean; requiresOwnerApproval: boolean } {
  const pricing01 = pricing / 100
  const risk01 = risk / 100
  const win01 = winProb / 100
  const deal01 = dealValue / 100
  const strat01 = strategicValue / 100

  const pricingAdj = (pricing01 - 0.5) * 0.10
  const competitionAdj = i.isPriceComparing ? 0.02 : 0
  const compLvlAdj = i.competitionLevel ? COMPETITION_PENALTY[i.competitionLevel] : 0

  // Floor rises with risk (risk premium covers potential bad debt).
  const riskPremium = Math.max(0, risk01 - 0.5) * 0.08
  const floor = clamp(b.floorMargin + riskPremium, 0.01, 0.95)

  // Target = anchor + pricing power − competition; never below floor.
  let target = b.targetMargin + pricingAdj - competitionAdj - compLvlAdj
  target = Math.max(target, floor)

  // Recommended = config recommended ± adjustments, then a win-lift concession
  // (only when win is low AND deal is big), clamped into [floor, target].
  let recommended = b.recommendedMargin + pricingAdj - competitionAdj - compLvlAdj
  const concession = win01 < 0.5 ? (0.5 - win01) * 0.06 * deal01 : 0
  recommended = clamp(recommended - concession, floor, target)

  const isStrategicCustomer = strategicValue >= STRATEGIC_VALUE_THRESHOLD
  // Strategic margin: higher strategic value → lower allowed margin, but never
  // below the configured absolute protection, never above floor.
  const strategicComputed = b.floorMargin - strat01 * 0.12
  const strategic = clamp(strategicComputed, b.strategicMargin, floor)

  const requiresOwnerApproval = isStrategicCustomer && strategic < floor - 0.001

  return {
    margins: { strategic, floor, recommended, target },
    isStrategicCustomer,
    requiresOwnerApproval,
  }
}

function buildPrices(unitCost: number, m: MarginLadder): PriceLadder {
  const at = (margin: number) => money(unitCost / (1 - clamp(margin, 0, 0.95)))
  return {
    unitCost: money(unitCost),
    strategic: at(m.strategic),
    floor: at(m.floor),
    recommended: at(m.recommended),
    target: at(m.target),
    rangeLow: at(m.recommended),
    rangeHigh: at(m.target),
  }
}

/**
 * Evaluate any proposed margin against the ladder + the customer's strategic
 * eligibility. This is the single source of truth for the approval gate.
 */
export function evaluateMargin(margin: number, m: MarginLadder, isStrategicCustomer: boolean): MarginVerdict {
  if (margin >= m.floor) return { status: 'ok', reason: `≥ 底线 ${pct(m.floor)}，可正常报价（仍为建议）` }
  if (margin >= m.strategic) {
    return isStrategicCustomer
      ? { status: 'owner_approval', reason: `低于普通底线 ${pct(m.floor)} 但 ≥ 战略底线 ${pct(m.strategic)} → 仅老板审批后允许执行` }
      : { status: 'forbidden', reason: `低于底线 ${pct(m.floor)}，且非战略客户 → 系统禁止` }
  }
  return { status: 'forbidden', reason: `低于战略底线 ${pct(m.strategic)} → 系统禁止（即使老板）` }
}

// ── Sample policy ─────────────────────────────────────────────────────────────
function buildSamplePolicy(
  i: QuoteEngineInput, winProb: number, risk: number, dealValue: number,
  isStrategicCustomer: boolean,
): SampleDecision {
  const tier = i.customerTier
  const unconverted = i.unconvertedSampleCount ?? 0
  const orderCount = i.orderCount ?? 0

  let level: 0 | 1 | 2 // 0=free 1=partial 2=full
  const reasons: string[] = []

  if ((isStrategicCustomer || tier === 'A') && winProb >= 60 && risk < 50 && dealValue >= 55) {
    level = 0
    reasons.push(isStrategicCustomer ? '高战略价值 + 成交概率高 → 投资型免费打样拿下客户' : 'A 级 + 高成交概率 → 主动补贴')
  } else if (tier === 'C' || tier === 'D' || winProb < 35 || risk >= 60 || i.isPriceComparing || orderCount === 0) {
    level = 2
    reasons.push(
      tier === 'C' || tier === 'D' ? '低等级' :
      winProb < 35 ? '成交概率低' :
      risk >= 60 ? '高风险' :
      i.isPriceComparing ? '客户在比价' : '新客户无历史',
    )
    reasons.push('先收齐样品费+运费，过滤白嫖')
  } else {
    level = 1
    reasons.push('中等成交概率 → 收成本（打样费/运费），成交后可抵扣')
  }

  // Anti-abuse overrides
  if (unconverted >= 2 && level < 2) { level = (level + 1) as 1 | 2; reasons.push(`历史取样 ${unconverted} 次未成交 → 强制升一档收费`) }
  if (i.fabricComplexity === 'high' && level === 0) { level = 1; reasons.push('特殊面料/高开发成本 → 至少半收费') }

  const policy: SamplePolicyKind = level === 0 ? 'free' : level === 1 ? 'partial' : 'full'
  // A strategic free sample is an investment → owner should see/approve cost.
  const requiresOwnerApproval = policy === 'free' && isStrategicCustomer

  return { policy, reason: reasons.join('；'), requiresOwnerApproval }
}

// ── Negotiation rules ─────────────────────────────────────────────────────────
function buildNegotiation(
  i: QuoteEngineInput, m: MarginLadder, prices: PriceLadder,
  risk: number, winProb: number, dealValue: number,
  sample: SampleDecision, needsRealCost: boolean,
): NegotiationRules {
  const allow: NegotiationRule[] = []
  const forbid: NegotiationRule[] = []
  const warnings: string[] = []

  // ✓ Sample subsidy
  if (sample.policy !== 'full') {
    allow.push({ label: sample.policy === 'free' ? '免费/补贴样品' : '样品收成本（可后抵扣）', reason: sample.reason })
  }
  // ✓ Small price concession — only if it stays ≥ floor and isn't a high-risk deal
  const room = m.recommended - m.floor
  if (room > 0.01 && risk < 60) {
    allow.push({
      label: `小幅让步至底线 ${pct(m.floor)}（约 $${prices.floor}/件）`,
      reason: `推荐 ${pct(m.recommended)} 与底线 ${pct(m.floor)} 之间有空间，让步后仍守住底线`,
    })
  }
  // ✓ Payment terms — only for low credit risk or existing relationship
  if ((norm10(i.creditRiskScore) ?? norm10(i.paymentRiskScore) ?? 1) <= 0.35 || i.hasRepeatOrder) {
    allow.push({ label: '可给 30 天账期', reason: i.hasRepeatOrder ? '有良好合作/付款史' : '付款风险低' })
  }

  // ✗ Below floor — always
  forbid.push({ label: `任何低于底线 ${pct(m.floor)} 的报价`, reason: '系统硬约束：低于底线即拒绝（战略报价除外，须老板审批）' })
  // ✗ High-risk credit on special fabric
  if (risk >= 60 && i.fabricComplexity === 'high') {
    forbid.push({ label: '特殊面料赊账', reason: '生产风险高 + 付款风险中以上 → 不赊账' })
  }
  // ✗ First quote at lowest to price-comparers
  if (i.isPriceComparing) {
    forbid.push({ label: '首报就给最低价', reason: '客户在比价 → 留谈判空间，不要一次报到底' })
  }
  // ✗ Concessions to high-risk customers (raise the floor instead)
  if (risk >= 60) {
    forbid.push({ label: '高风险客户降价让利', reason: '风险已抬高底线，应先收紧账期/要求预付，不建议让价' })
  }

  // Warnings
  if ((i.orderCount ?? 0) === 0) warnings.push('新客户无历史订单 → 建议首单预付 30%')
  if (needsRealCost) warnings.push('品类成本为系统默认基准（未确认真实成本）→ 仅供参考，请核实后据此报价')
  if ((i.unconvertedSampleCount ?? 0) >= 2) warnings.push('该客户多次取样未成交 → 样品收费已自动升档')

  return { allow, forbid, warnings }
}

// ── Main ────────────────────────────────────────────────────────────────────────
export function computeQuoteStrategy(input: QuoteEngineInput, baseline: PricingBaseline): QuoteStrategy {
  const qty = Math.max(1, Math.round(input.qty || baseline.moq))
  const i: QuoteEngineInput = { ...input, qty }

  const pricing = scorePricing(i)
  const dealValue = scoreDealValue(i)
  const winProbability = scoreWinProbability(i)
  const risk = scoreRisk(i)
  const strategicValue = scoreStrategicValue(i)

  const { margins, isStrategicCustomer, requiresOwnerApproval } = buildMargins(
    baseline, pricing.score, risk.score, winProbability.score, dealValue.score, strategicValue.score, i,
  )
  const fabricMaterial: FabricMaterial = i.fabricMaterial ?? 'poly_spandex'
  const plusSize = !!i.plusSize
  const costBasis = computeCostBasis(baseline, qty, fabricMaterial, plusSize)
  const prices = buildPrices(costBasis.unitCost, margins)
  const samplePolicy = buildSamplePolicy(i, winProbability.score, risk.score, dealValue.score, isStrategicCustomer)
  const negotiation = buildNegotiation(i, margins, prices, risk.score, winProbability.score, dealValue.score, samplePolicy, baseline.needsRealCost)

  const strategicNote = requiresOwnerApproval
    ? `战略底线 ${pct(margins.strategic)}（低于普通底线 ${pct(margins.floor)}）— ⚠ 仅老板审批后允许执行，系统不会自动报价`
    : isStrategicCustomer
      ? `高战略价值客户，但风险溢价后战略空间有限（战略底线 ≈ 普通底线 ${pct(margins.floor)}）`
      : null

  const explanation = buildExplanation(i, baseline, margins, prices, pricing, risk, winProbability, dealValue, strategicValue, isStrategicCustomer, requiresOwnerApproval, samplePolicy)

  return {
    category: baseline.category,
    categoryLabel: baseline.label,
    qty,
    fabricComplexity: i.fabricComplexity,
    fabricMaterial,
    plusSize,
    costBasis,
    scores: { pricing, dealValue, winProbability, risk, strategicValue },
    margins,
    prices,
    isStrategicCustomer,
    requiresOwnerApproval,
    strategicNote,
    competition: i.competitionMeta,
    samplePolicy,
    negotiation,
    explanation,
    cac: null,
    needsRealCost: baseline.needsRealCost,
    disclaimer: '本结果为系统建议（recommendation / suggestion），不自动报价、不自动发送给客户。最终报价由业务员决定；低于底线的战略报价须老板审批。',
    kind: 'recommendation',
  }
}

function buildExplanation(
  i: QuoteEngineInput, b: PricingBaseline, m: MarginLadder, p: PriceLadder,
  pricing: ScoreResult, risk: ScoreResult, win: ScoreResult, deal: ScoreResult, strat: ScoreResult,
  isStrategicCustomer: boolean, requiresOwnerApproval: boolean, sample: SampleDecision,
): QuoteExplanation {
  const marginParts: string[] = []
  marginParts.push(`以 ${b.label} 基准（目标 ${pct(b.targetMargin)} / 底线 ${pct(b.floorMargin)}）为起点`)
  if (pricing.score >= 60) marginParts.push(`定价权较强(${pricing.score}) → 上调目标`)
  else if (pricing.score <= 40) marginParts.push(`定价权偏弱(${pricing.score}) → 下调目标`)
  if (risk.score >= 55) marginParts.push(`风险偏高(${risk.score}) → 底线抬高至 ${pct(m.floor)} 覆盖坏账`)
  if (win.score < 50 && deal.score > 60) marginParts.push(`成交概率低(${win.score})但单值大(${deal.score}) → 推荐适度让利至 ${pct(m.recommended)}`)
  const marginText = `${marginParts.join('；')}。推荐 ${pct(m.recommended)}（约 $${p.recommended}/件），区间 $${p.rangeLow}–$${p.rangeHigh}。`

  let concessionText: string
  if (requiresOwnerApproval) {
    concessionText = `战略价值高(${strat.score} ≥ ${STRATEGIC_VALUE_THRESHOLD}) → 解锁战略报价区间，允许低至 ${pct(m.strategic)}（普通底线 ${pct(m.floor)} 之下），但必须经老板审批才能执行；低于 ${pct(m.strategic)} 系统永远禁止。`
  } else if (risk.score >= 60) {
    concessionText = `风险高(${risk.score}) → 不建议让价；应先要求预付/收紧账期，底线 ${pct(m.floor)} 为硬红线。`
  } else if (m.recommended - m.floor > 0.01) {
    concessionText = `可在推荐 ${pct(m.recommended)} 与底线 ${pct(m.floor)} 之间小幅让步（让步后仍守底线）；${i.isPriceComparing ? '客户在比价，首轮勿报最低。' : '低于底线一律禁止。'}`
  } else {
    concessionText = `让步空间很小（推荐≈底线 ${pct(m.floor)}）→ 基本不让价，低于底线禁止。`
  }

  const sampleText = `样品：${sample.policy === 'free' ? '免费寄送（战略投资）' : sample.policy === 'partial' ? '收成本（打样费/运费），成交后可抵扣' : '全额收费（过滤比价/白嫖）'} — ${sample.reason}${sample.requiresOwnerApproval ? '；免费样品成本较高，建议老板审批' : ''}。`

  const overall = `${isStrategicCustomer ? '战略客户：长期价值优先。' : '常规成交：守住利润。'}成交概率 ${win.score} / 风险 ${risk.score} / 战略价值 ${strat.score}。${requiresOwnerApproval ? '本方案含战略报价，须老板审批，系统不自动执行。' : '系统仅给建议，不自动报价、不自动发送。'}`

  return { margin: marginText, concession: concessionText, sample: sampleText, overall }
}
