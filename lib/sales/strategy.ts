/**
 * ================= STRATEGY LEARNING LAYER (Strategy OS) =================
 * The system no longer just executes the right action — it learns which SALES
 * STRATEGY (wedge × cta × tone × segment) converts best, per segment.
 *
 * A StrategyUnit's stats are NOT stored: they're recomputed live from the
 * strategyId stamped onto each sent outreach_log (see load-strategies.ts).
 * So the loop self-optimizes with zero manual retraining and zero new tables.
 */
export type Wedge = 'cold_email' | 'follow_up' | 'sample_first' | 'quote_first'
export type Cta = 'ask_sample' | 'ask_reply' | 'ask_quote' | 'ask_decision'
export type Tone = 'direct' | 'consultative' | 'urgent' | 'low_pressure'
export type Segment = 'high_value' | 'mid_value' | 'low_value'
export type StrategyResult = 'no_response' | 'reply' | 'sample_requested' | 'quote_requested' | 'po_closed'

// ── V7 Causal Strategy Engine ──────────────────────────────────────────────
export type StrategyVector = { message: number; timing: number; contact: number }
export type SituationVector = { urgency: number; contactStrength: number; engagement: number }
export type CausalAttribution = { messageImpact: number; timingImpact: number; contactImpact: number }
export type CausalContext = { timeSinceLastTouch: number | null; contactQuality: number | null; strategyId: string }

export interface StrategyStats {
  impressions: number
  replies: number
  samples: number
  quotes: number
  pos: number
}
export interface StrategyUnit {
  id: string
  name: string
  wedge: Wedge
  cta: Cta
  tone: Tone
  segment: Segment
  templateId: string
  stats: StrategyStats
  effectivenessScore: number // summary scalar (vector magnitude) — display only, NOT used for selection
  vector: StrategyVector // V7 — learned causal effectiveness per dimension
  replyRate: number // V7 — selection tiebreaker
}
export interface StrategyOutcomeLog {
  strategyId: string
  accountId: string
  actionType: string
  result: StrategyResult
  timestamp: number
  valueGenerated: number
}

export interface TemplateVars { name: string; company: string; product_type: string; segmentLabel: string }

const zeroStats = (): StrategyStats => ({ impressions: 0, replies: 0, samples: 0, quotes: 0, pos: 0 })
const zeroVector = (): StrategyVector => ({ message: 0, timing: 0, contact: 0 })
function mk(id: string, name: string, wedge: Wedge, cta: Cta, tone: Tone, segment: Segment, templateId: string): StrategyUnit {
  return { id, name, wedge, cta, tone, segment, templateId, stats: zeroStats(), effectivenessScore: 0, vector: zeroVector(), replyRate: 0 }
}

/** Fixed, deterministic strategy catalog. Stats filled live; nothing hand-tuned. */
export const STRATEGY_CATALOG: StrategyUnit[] = [
  mk('hv_sample_consult', '样品优先 · 顾问式', 'sample_first', 'ask_sample', 'consultative', 'high_value', 'tmpl_sample_consult'),
  mk('hv_quote_decision', '报价优先 · 促决策', 'quote_first', 'ask_decision', 'consultative', 'high_value', 'tmpl_quote_decision'),
  mk('hv_followup_direct', '跟进 · 直接', 'follow_up', 'ask_reply', 'direct', 'high_value', 'tmpl_followup_direct'),
  mk('mv_cold_sample', '冷启 · 提样品', 'cold_email', 'ask_sample', 'direct', 'mid_value', 'tmpl_cold_sample'),
  mk('mv_sample_lowpressure', '样品优先 · 低压', 'sample_first', 'ask_sample', 'low_pressure', 'mid_value', 'tmpl_sample_lowpressure'),
  mk('mv_followup_urgent', '跟进 · 紧迫', 'follow_up', 'ask_reply', 'urgent', 'mid_value', 'tmpl_followup_urgent'),
  mk('lv_cold_reply', '冷启 · 求回复', 'cold_email', 'ask_reply', 'low_pressure', 'low_value', 'tmpl_cold_reply'),
  mk('lv_followup_sample', '跟进 · 提样品', 'follow_up', 'ask_sample', 'direct', 'low_value', 'tmpl_cold_sample'),
]

const SEG_LABEL: Record<Segment, string> = { high_value: 'premium DTC', mid_value: 'growing DTC', low_value: 'emerging DTC' }
export function segmentLabel(s: Segment): string { return SEG_LABEL[s] }

/** Templates only — no free-text AI. {{name}}/{{product_type}}/{{segment}} injection. */
export const STRATEGY_TEMPLATES: Record<string, (v: TemplateVars) => { subject: string; body: string }> = {
  tmpl_sample_consult: (v) => ({
    subject: `${v.company} × Qimo — a sample to evaluate`,
    body: `Hi ${v.name},\n\nWe specialize in ${v.product_type} for ${v.segmentLabel} brands. Rather than pitch, we'd let the product speak — we can send a sample immediately.\n\nCould you confirm a shipping address and the style you'd like?\n\nBest,\nQimo (Jojofashion)`,
  }),
  tmpl_quote_decision: (v) => ({
    subject: `${v.company} × Qimo — trial-order pricing`,
    body: `Hi ${v.name},\n\nWe make ${v.product_type} for ${v.segmentLabel} brands at low MOQ. If you share a target style and quantity, I'll send trial-order pricing so you can make a call quickly.\n\nShall I prepare it?\n\nBest,\nQimo (Jojofashion)`,
  }),
  tmpl_followup_direct: (v) => ({
    subject: `Re: ${v.company} × Qimo`,
    body: `Hi ${v.name},\n\nFollowing up directly — are you open to evaluating ${v.product_type} samples from us? One reply and I'll get it moving.\n\nBest,\nQimo (Jojofashion)`,
  }),
  tmpl_cold_sample: (v) => ({
    subject: `${v.company} × Qimo — free ${v.product_type} sample`,
    body: `Hi ${v.name},\n\nWe manufacture ${v.product_type} for ${v.segmentLabel} brands with low MOQs and 7–10 day sampling. We can send a sample immediately — just confirm a shipping address and the style you'd like.\n\nBest,\nQimo (Jojofashion)`,
  }),
  tmpl_sample_lowpressure: (v) => ({
    subject: `${v.company} — no-pressure ${v.product_type} sample`,
    body: `Hi ${v.name},\n\nNo pitch — if it's ever useful, we're happy to send a free ${v.product_type} sample so you can judge our quality on your own time. Just reply with a style and address whenever it fits.\n\nBest,\nQimo (Jojofashion)`,
  }),
  tmpl_followup_urgent: (v) => ({
    subject: `${v.company} — closing our sampling slots this week`,
    body: `Hi ${v.name},\n\nQuick follow-up — we have a couple of open sampling slots this week for ${v.product_type}. If you'd like one, reply today and I'll reserve it for ${v.company}.\n\nBest,\nQimo (Jojofashion)`,
  }),
  tmpl_cold_reply: (v) => ({
    subject: `${v.company} × Qimo — quick question`,
    body: `Hi ${v.name},\n\nWe make ${v.product_type} for ${v.segmentLabel} brands. Would it be worth a quick look at what we could produce for you? A one-line reply is all I need to share details.\n\nBest,\nQimo (Jojofashion)`,
  }),
}

export function fillTemplate(templateId: string, v: TemplateVars): { subject: string; body: string } {
  const t = STRATEGY_TEMPLATES[templateId] ?? STRATEGY_TEMPLATES.tmpl_cold_sample
  return t(v)
}
export function generateStrategyMessage(strategy: StrategyUnit, v: TemplateVars): { subject: string; body: string } {
  return fillTemplate(strategy.templateId, v)
}

/** CORE FEATURE 1 — strategy scoring (spec formula) + evolution reinforcement (Feature 5). */
export function computeStrategyScore(strategy: StrategyUnit): number {
  const r = strategy.stats
  const replyRate = r.replies / Math.max(1, r.impressions)
  const sampleRate = r.samples / Math.max(1, r.replies)
  const quoteRate = r.quotes / Math.max(1, r.samples)
  const poRate = r.pos / Math.max(1, r.quotes)

  const base = replyRate * 0.3 + sampleRate * 0.3 + quoteRate * 0.2 + poRate * 0.2
  const variancePenalty = 1 / Math.sqrt(r.impressions + 1) // optimistic-under-uncertainty: untried strategies explore

  let score = base * variancePenalty
  // Feature 5 — automatic adaptation
  if (r.pos > 0) score *= 1.2 // positive reinforcement: a PO closed on this play
  if (r.impressions >= 10 && replyRate < 0.1) score *= 0.8 // negative: enough data, cold
  return score
}

export const expectedOutcomeFor: Record<Cta, StrategyResult> = {
  ask_sample: 'sample_requested',
  ask_reply: 'reply',
  ask_quote: 'quote_requested',
  ask_decision: 'po_closed',
}

/** value → segment (thresholds are the only knob; no per-account hand-tuning). */
export function segmentForValue(poValueUsd: number): Segment {
  if (poValueUsd >= 50_000) return 'high_value'
  if (poValueUsd >= 20_000) return 'mid_value'
  return 'low_value'
}
export const matchesSegment = (s: StrategyUnit, seg: Segment) => s.segment === seg

// ── V7 causal decomposition + vector selection ─────────────────────────────
const OUTCOME_MSG: Record<StrategyResult, number> = { no_response: -0.4, reply: 0.4, sample_requested: 0.6, quote_requested: 0.8, po_closed: 1.0 }

/**
 * Deterministic causal breakdown of one outcome (spec §3A). Real signals only.
 *  reply/sample/quote/po → +message ; no_response → −message
 *  positive outcome → +timing ; fast (<24h) → +timing
 *  present contact quality → +contact ; MISSING signal → 0 (never inferred)
 */
export function decomposeOutcome(outcome: StrategyResult, ctx: CausalContext): CausalAttribution {
  const positive = outcome !== 'no_response'
  const fast = ctx.timeSinceLastTouch != null && ctx.timeSinceLastTouch < 1
  return {
    messageImpact: OUTCOME_MSG[outcome] ?? 0,
    timingImpact: (positive ? 0.2 : 0) + (fast ? 0.2 : 0),
    contactImpact: ctx.contactQuality != null ? ctx.contactQuality * 0.3 : 0,
  }
}

/** Add impact to a vector dimension and clamp to [0,1] (spec §3B). */
export const clamp01 = (n: number): number => Math.max(0, Math.min(1, n))

// Aligned dims: message↔engagement, timing↔urgency, contact↔contactStrength.
const sVec = (s: StrategyUnit): [number, number, number] => [s.vector.message, s.vector.timing, s.vector.contact]
const cVec = (v: SituationVector): [number, number, number] => [v.engagement, v.urgency, v.contactStrength]
function cosine(a: [number, number, number], b: [number, number, number]): number {
  const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
  const na = Math.hypot(a[0], a[1], a[2])
  const nb = Math.hypot(b[0], b[1], b[2])
  return na && nb ? dot / (na * nb) : 0
}

/** CORE FEATURE 5 — 1-line causal explanation of the selection. */
export function explainSelection(strategy: StrategyUnit, situation: SituationVector): string {
  const dims: [string, number][] = [
    ['消息', strategy.vector.message],
    ['时机', strategy.vector.timing],
    ['联系人', strategy.vector.contact],
  ]
  const dom = dims.slice().sort((a, b) => b[1] - a[1])[0][0]
  const lvl = (n: number) => (n >= 0.66 ? '高' : n >= 0.33 ? '中' : '低')
  return `向量匹配：${dom}维度主导 · 情境 时机${lvl(situation.urgency)}/联系人${lvl(situation.contactStrength)}/参与${lvl(situation.engagement)}`
}

/** CORE FEATURE 2 — select by cosine(strategy.vector, situation); tiebreak = reply rate. */
export function selectStrategy(situation: SituationVector, strategies: StrategyUnit[], segment: Segment): StrategyUnit {
  const pool = strategies.filter((s) => matchesSegment(s, segment))
  const cand = pool.length ? pool : strategies
  const sv = cVec(situation)
  return cand
    .slice()
    .sort((a, b) => {
      const d = cosine(sVec(b), sv) - cosine(sVec(a), sv)
      if (Math.abs(d) > 1e-9) return d
      if (b.replyRate !== a.replyRate) return b.replyRate - a.replyRate
      return a.id.localeCompare(b.id)
    })[0]
}
