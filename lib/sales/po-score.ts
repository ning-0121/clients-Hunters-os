/**
 * ============================ PO GENERATION ENGINE ============================
 * A self-learning revenue execution engine. Single objective: maximize real PO
 * generation. Closed loop: PO_SCORE → ACTION CARD → EXECUTION → OUTCOME → MODEL
 * UPDATE (see po-learn.ts for the OUTCOME→UPDATE half).
 *
 *   PO_SCORE = (P_PO × V_PO × T_DECAY) × R_TOUCH × R_SAMPLE × R_QUOTE × R_SUPPLY
 *              × R_RESPONSE − FRICTION
 *
 * Coefficients live in a Weights object so the learner can recalibrate them from
 * real outcomes. DEFAULT_WEIGHTS are the spec's priors, verbatim. Every card is
 * execution-ready (prewritten message included) — the user only approves.
 */
import { type FunnelStage } from '@/lib/sales/order-engine'

// ── learnable weights (recalibrated by po-learn.ts from real outcomes) ──────
export interface Weights {
  pPo: { reply: number; sample: number; quote: number; buying: number; category: number; floor: number }
  vPoMarginPct: number
  decayTau: number
  rResponse: { recent: number; mid: number; cold: number }
  rSample: { requested: number; sent: number; none: number }
  friction: { missingContact: number; stale: number; enrichmentUncertain: number; missingNextAction: number }
}
export const DEFAULT_WEIGHTS: Weights = {
  pPo: { reply: 0.3, sample: 0.25, quote: 0.2, buying: 0.15, category: 0.1, floor: 0.02 },
  vPoMarginPct: 0.18, // V_PO = order value × margin. Documented assumption; learner ↑ on po_created.
  decayTau: 14,
  rResponse: { recent: 2.0, mid: 1.2, cold: 0.5 },
  rSample: { requested: 1.5, sent: 1.0, none: 0.3 },
  friction: { missingContact: 0.6, stale: 0.2, enrichmentUncertain: 0.15, missingNextAction: 0.15 },
}
const UNTOUCHED_DECAY = 0.8
const STALE_DAYS = 30
const BLOCKED_MULT = 0.03 // Hard Rule #3: no valid contact → BLOCKED (crushed, excluded from ranking)

export interface PoSignals {
  companyId: string
  brand: string
  stage: FunnelStage
  dmName: string | null
  category: string | null
  replied: boolean
  sampleRequested: boolean
  hasQuoteHistory: boolean
  buyingSignal: boolean
  customerTypeMatch: boolean
  poValueUsd: number
  lastTouchDays: number | null
  emailVerified: boolean
  responseHistory: boolean
  sampleSent: boolean
  quoteExpired: boolean
  supply: 'gap' | 'stable' | 'unknown'
  replyAgeDays: number | null
  hasAnyContact: boolean
  enrichmentUncertain: boolean
  hasNextAction: boolean
}

// ── the eight factors (spec coefficients, now weight-driven) ────────────────
/** P_PO = weighted sum of base-probability signals (spec §4), clamped to [floor, 1]. */
export function pPo(s: PoSignals, w: Weights): number {
  const p =
    w.pPo.reply * (s.replied ? 1 : 0) +
    w.pPo.sample * (s.sampleRequested ? 1 : 0) +
    w.pPo.quote * (s.hasQuoteHistory ? 1 : 0) +
    w.pPo.buying * (s.buyingSignal ? 1 : 0) +
    w.pPo.category * (s.customerTypeMatch ? 1 : 0)
  return Math.min(1, Math.max(w.pPo.floor, p))
}
const vPo = (s: PoSignals, w: Weights) => Math.max(0, s.poValueUsd) * w.vPoMarginPct
const tDecay = (days: number | null, w: Weights) => (days == null ? UNTOUCHED_DECAY : Math.exp(-Math.max(0, days) / w.decayTau))
const rTouch = (s: PoSignals) => (s.emailVerified ? 0.6 : 0) + (s.responseHistory ? 0.4 : 0)
const rSample = (s: PoSignals, w: Weights) => (s.sampleRequested ? w.rSample.requested : s.sampleSent ? w.rSample.sent : w.rSample.none)
const rQuote = (s: PoSignals) => (s.quoteExpired ? 0.5 : s.hasQuoteHistory ? 1.3 : 1.0)
const rSupply = (s: PoSignals) => (s.supply === 'gap' ? 1.2 : s.supply === 'stable' ? 0.7 : 1.0)
const rResponse = (s: PoSignals, w: Weights) =>
  s.replyAgeDays != null && s.replyAgeDays < 7 ? w.rResponse.recent : s.replyAgeDays != null && s.replyAgeDays < 30 ? w.rResponse.mid : w.rResponse.cold

export interface PoCard {
  companyId: string
  brand: string
  stage: FunnelStage
  dmName: string | null
  poScore: number
  gross: number
  friction: number
  frictionRate: number
  blocked: boolean
  factors: Record<string, number>
  recommendedAction: string
  prewrittenMessage: { channel: 'email' | 'whatsapp'; subject?: string; body: string }
  reason: string
  nextActionChain: string[]
  estimatedPoImpact: number // expected PO $ = P_PO × V_PO(order value)
}

/** Compute the full execution-ready Action Card for one account. Pure + deterministic. */
export function poScore(s: PoSignals, w: Weights = DEFAULT_WEIGHTS): PoCard {
  const P = pPo(s, w)
  const V = vPo(s, w)
  const T = tDecay(s.lastTouchDays, w)
  const rt = rTouch(s)
  const rsa = rSample(s, w)
  const rq = rQuote(s)
  const rsu = rSupply(s)
  const rr = rResponse(s, w)
  const gross = P * V * T * rt * rsa * rq * rsu * rr

  let rate = 0
  if (!s.hasAnyContact) rate += w.friction.missingContact
  if (s.lastTouchDays != null && s.lastTouchDays > STALE_DAYS) rate += w.friction.stale
  if (s.enrichmentUncertain) rate += w.friction.enrichmentUncertain
  if (!s.hasNextAction) rate += w.friction.missingNextAction
  rate = Math.min(0.9, rate)
  const friction = gross * rate
  let score = gross - friction

  const blocked = !s.hasAnyContact || rt === 0 // Hard Rule #3
  if (blocked) score *= BLOCKED_MULT

  const act = buildAction(s) // Hard Rules #2/#4: action + message always generated
  return {
    companyId: s.companyId,
    brand: s.brand,
    stage: s.stage,
    dmName: s.dmName,
    poScore: Math.round(score),
    gross: Math.round(gross),
    friction: Math.round(friction),
    frictionRate: +rate.toFixed(2),
    blocked,
    factors: { P_PO: +P.toFixed(3), V_PO: Math.round(V), T_DECAY: +T.toFixed(2), R_TOUCH: +rt.toFixed(2), R_SAMPLE: rsa, R_QUOTE: rq, R_SUPPLY: rsu, R_RESPONSE: rr },
    recommendedAction: act.top,
    prewrittenMessage: act.msg,
    reason: act.reason,
    nextActionChain: act.chain,
    estimatedPoImpact: Math.round(P * Math.max(0, s.poValueUsd)),
  }
}

const k = (n: number) => `$${Math.round(Math.max(0, n) / 1000)}k`
const firstName = (full: string | null) => (full ? full.trim().split(/\s+/)[0] : 'there')
const cat = (c: string | null) => c || 'activewear'

/** Hard Rules #1–#4: resolve every account into CONTACT → ACTION → NEXT ACTION,
 *  with a fully prewritten, ready-to-send message. User writes nothing. */
function buildAction(s: PoSignals): {
  top: string
  reason: string
  chain: string[]
  msg: { channel: 'email' | 'whatsapp'; subject?: string; body: string }
} {
  const val = k(s.poValueUsd)
  const fn = firstName(s.dmName)
  const category = cat(s.category)

  if (!s.hasAnyContact)
    return {
      top: '补联系人：Apollo/Hunter 找采购或创始人邮箱（无此步无法推进）',
      reason: `无可用联系人 · 预期PO ${val} 被锁\n先补一个可达决策人`,
      chain: ['今天：Apollo/Hunter 找采购/创始人邮箱', 'Day+1：验证邮箱可达性', 'Day+2：验证通过发首封'],
      msg: { channel: 'email', body: '（暂无联系人 — 补齐可达决策人邮箱后自动生成开发信）' },
    }
  if (!s.emailVerified)
    return {
      top: '验证邮箱：现有联系人邮箱未验证，先验证再发（防退信）',
      reason: `有联系人但邮箱未验证 · 预期PO ${val}\n验证后解锁发送`,
      chain: ['今天：验证现有联系人邮箱', 'Day+1：通过则发首封', 'Day+4：未回发跟进#2'],
      msg: { channel: 'email', body: '（邮箱待验证 — 验证通过后自动生成可发送开发信）' },
    }

  switch (s.stage) {
    case 'replied':
      return {
        top: '趁热提样品：回信给样品 offer，要收货地址 + 目标数量/目标价',
        reason: `已回复${s.replyAgeDays != null ? `（${s.replyAgeDays}天）` : ''}·最强信号 · 预期PO ${val}`,
        chain: ['今天：回信提样品 + 要地址/目标量', 'Day+2：未回则电话', 'Day+5：确认规格并寄样'],
        msg: {
          channel: 'email',
          subject: `Re: ${s.brand} × Qimo — happy to send samples`,
          body: `Hi ${fn},\n\nThanks for getting back to me. The fastest way to show you our quality is a physical sample — we can turn a ${category} sample in 7–10 days at no cost to you.\n\nTo get it moving, could you share:\n1) A shipping address\n2) The style(s) you'd like us to sample\n3) Target order quantity + target price, if you have one\n\nOnce I have these I'll confirm specs and ship, with a tracking number.\n\nBest,\nQimo (Jojofashion) — activewear ODM`,
        },
      }
    case 'sample_requested':
      return {
        top: '客户已要样：确认规格并寄样，回传运单号',
        reason: `客户主动要样（最强意向）· 预期PO ${val}\n寄样速度直接影响成单`,
        chain: ['今天：确认规格 + 寄样', '寄出+3天：确认收到并约反馈', '反馈+2天：据反馈出报价'],
        msg: {
          channel: 'email',
          subject: `${s.brand} sample — confirming specs before we ship`,
          body: `Hi ${fn},\n\nGreat — let's get your ${category} sample out. Quick confirmation so it's exactly right:\n• Style / reference\n• Fabric (nylon / poly / cotton / fleece / seamless)\n• Colorway + size\n• Ship-to address + preferred courier\n\nReply with these and we'll ship within 3–5 days and send you the tracking number.\n\nBest,\nQimo (Jojofashion)`,
        },
      }
    case 'sample_sent':
      return {
        top: '追样品反馈：是否合格？能否安排试单？',
        reason: `样品在客户手上 · 预期PO ${val}\n无反馈=停滞`,
        chain: ['今天：追样品反馈', 'Day+3：未回则电话', '拿到反馈：出正式报价'],
        msg: {
          channel: 'email',
          subject: `${s.brand} — how did the sample land?`,
          body: `Hi ${fn},\n\nChecking in on the ${category} sample we sent. Two quick questions:\n1) Did the quality / fit meet your standard?\n2) If yes, shall we scope a first trial order? I can put together pricing at your target quantity.\n\nHappy to adjust anything on a second sample if needed.\n\nBest,\nQimo (Jojofashion)`,
        },
      }
    case 'quotation':
      return s.quoteExpired
        ? {
            top: '报价已过期：更新成本后重报 + 限时激励促试单',
            reason: `报价已过期 · 预期PO ${val}\n需重启`,
            chain: ['今天：更新成本重报', 'Day+2：电话确认', 'Day+5：提试单 MOQ'],
            msg: { channel: 'email', subject: `${s.brand} — refreshed quote (valid 14 days)`, body: `Hi ${fn},\n\nOur earlier quote has lapsed, so here's a refreshed one with current costing. To help you move on a first order, I've held our best trial-order pricing for the next 14 days.\n\nCan we lock a trial quantity this week? I'll issue a PI the same day.\n\nBest,\nQimo (Jojofashion)` },
          }
        : {
            top: '追报价进度：给限时激励，提试单 MOQ 与交期',
            reason: `已报价 · 预期PO ${val}\n把"考虑中"逼向试单`,
            chain: ['今天：追报价进度', 'Day+3：给限时激励', 'Day+7：提试单并要 PO'],
            msg: { channel: 'email', subject: `${s.brand} — ready to start with a trial order?`, body: `Hi ${fn},\n\nFollowing up on the quote. If pricing works, I'd suggest a small trial order so you can validate quality and lead time with low risk — we can start at a low MOQ.\n\nShall I prepare a PI for a trial quantity? Lead time is ~[X] days from deposit.\n\nBest,\nQimo (Jojofashion)` },
          }
    case 'trial_order':
      return {
        top: '敲定试单 PO：确认数量/交期/付款，发 PI',
        reason: `试单谈判中（临门一脚）· 预期PO ${val}`,
        chain: ['今天：确认 PO 条款', 'Day+2：发 PI', 'Day+5：确认定金排产'],
        msg: { channel: 'whatsapp', body: `Hi ${fn}, ready to lock your ${s.brand} trial order. Confirm qty, delivery date and payment terms and I'll send the PI today so we can start production. — Qimo` },
      }
    case 'scale_order':
      return {
        top: '复购放量：锁产能，推大货框架',
        reason: `复购客户（最高价值）· 预期PO ${val}`,
        chain: ['今天：确认返单量', 'Day+3：锁产能', 'Day+7：签大货框架'],
        msg: { channel: 'whatsapp', body: `Hi ${fn}, great to see ${s.brand} reordering. Send me your projected quantity and I'll reserve production capacity + propose a bulk framework so you get priority + better pricing. — Qimo` },
      }
    default: // discovered / contact_captured / outreach_sent
      return s.stage === 'outreach_sent'
        ? {
            top: '跟进#2：换钩子（痛点 + 同类客户案例），绝不问"是否有用"',
            reason: `已发首封${s.lastTouchDays != null ? `${s.lastTouchDays}天` : ''}无回复 · 预期PO ${val}`,
            chain: ['今天：发跟进#2（新钩子）', 'Day+4：第3封（社证/案例）', 'Day+9：换联系人或电话'],
            msg: { channel: 'email', subject: `Re: ${s.brand} × Qimo — a faster way to sample`, body: `Hi ${fn},\n\nCircling back. Brands like yours usually get stuck between MOQ and speed — we solve both: low MOQ for ${category} plus 7–10 day sampling, so you can test a style without committing to a big run.\n\nIf useful, I'll send a free sample of your choice — just reply with a style and a ship-to address.\n\nBest,\nQimo (Jojofashion)` },
          }
        : {
            top: '发首封开发信：钩子=活动服 ODM + 快反打样 + 小单起订',
            reason: `已定位未触达 · 预期PO ${val}\n先建立触点`,
            chain: ['今天：发首封开发信', 'Day+4：跟进#2', 'Day+9：换联系人'],
            msg: { channel: 'email', subject: `${s.brand} × Qimo — activewear ODM, low MOQ, 7-day samples`, body: `Hi ${fn},\n\nI'm with Qimo (Jojofashion), an activewear ODM factory in China. We produce ${category} for DTC brands — leggings, sports bras, sets — with low MOQs and 7–10 day sampling.\n\nIf you're evaluating manufacturing partners, I'd love to send a free sample so you can judge our quality directly. Which style should we make for you, and where do we ship it?\n\nBest,\nQimo (Jojofashion)` },
          }
  }
}
