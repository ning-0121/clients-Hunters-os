/**
 * QIMO Order Engine — funnel tracking whose only KPI is signed POs.
 *
 * One canonical funnel, derived from EVIDENCE in the existing tables (no new
 * discovery, no new scoring). Coverage is size-relative (never penalize a small
 * brand for roles that don't exist). Every account gets ONE required action today
 * that moves it to the next stage. Sample-first: outreach offers a specific sample.
 */
import { computeCredibility, isReachableTier } from '@/lib/contacts/credibility'

export const FUNNEL = [
  'discovered', 'contact_captured', 'outreach_sent', 'replied',
  'sample_requested', 'sample_sent', 'quotation', 'trial_order', 'scale_order',
] as const
export type FunnelStage = (typeof FUNNEL)[number]
export const stageIndex = (s: FunnelStage) => FUNNEL.indexOf(s)

export const FUNNEL_LABEL: Record<FunnelStage, string> = {
  discovered: '已发现', contact_captured: '已捕获联系人', outreach_sent: '已发开发信',
  replied: '已回复', sample_requested: '已要样', sample_sent: '已寄样',
  quotation: '已报价', trial_order: '试单', scale_order: '返单/放量',
}

// ── Size-relative coverage ────────────────────────────────────────────────────
export type CompanySize = 'small' | 'medium' | 'large'

export function companySize(employeeRange?: string | null): CompanySize {
  const e = (employeeRange ?? '').toLowerCase()
  if (/(^|[^0-9])(201|301|500|501|1[,.]?000|1001|5[,.]?000|10[,.]?000)|\b500\+|\b1000\+|201-|501-/.test(e)) return 'large'
  if (/51-200|51-?100|101-?200|201-?500/.test(e)) return 'medium'
  return 'small' // unknown / 1-10 / 11-50 → treat as small founder-led
}

export interface RoleFlags {
  founder: boolean; operations: boolean; production: boolean; productDev: boolean; sourcing: boolean
  founderReachableEmailLi: boolean
}

interface ContactLite {
  role_type?: string | null; title?: string | null; linkedin_url?: string | null
  email?: string | null; email_verified?: boolean | null; email_source?: string | null; email_confidence?: number | null
}

export function roleFlags(contacts: ContactLite[]): RoleFlags {
  const has = (re: RegExp, roleType?: string) => contacts.some((c) =>
    (roleType && (c.role_type ?? '').toLowerCase() === roleType) || re.test((c.title ?? '').toLowerCase()))
  const founder = has(/founder|ceo|owner|chief exec|president/, 'founder')
  const operations = has(/operations|coo|chief operating|supply chain|logistics/)
  const production = has(/produc/, 'production')
  const productDev = has(/product develop|merchandis|developer|head of product/, 'product')
  const sourcing = has(/sourc|purchas|buyer/, 'sourcing')
  const founderReachableEmailLi = contacts.some((c) => {
    const isFounder = (c.role_type ?? '').toLowerCase() === 'founder' || /founder|ceo|owner|chief exec|president/.test((c.title ?? '').toLowerCase())
    const reach = isReachableTier(computeCredibility(c).tier)
    return isFounder && reach && !!c.linkedin_url
  })
  return { founder, operations, production, productDev, sourcing, founderReachableEmailLi }
}

/** Size-relative capture rule (per the Order Engine mandate). */
export function isCovered(size: CompanySize, f: RoleFlags): boolean {
  if (size === 'large') return f.founder && f.sourcing && f.production && f.productDev && f.operations
  if (size === 'medium') return f.founder && f.operations && f.productDev
  return f.founderReachableEmailLi // small founder-led: founder + email + linkedin
}

/** What's still missing for capture (for the gap column). */
export function coverageGaps(size: CompanySize, f: RoleFlags): string[] {
  if (size === 'large') return [['founder', f.founder], ['sourcing', f.sourcing], ['production', f.production], ['productDev', f.productDev], ['operations', f.operations]].filter(([, v]) => !v).map(([k]) => k as string)
  if (size === 'medium') return [['founder', f.founder], ['operations', f.operations], ['productDev', f.productDev]].filter(([, v]) => !v).map(([k]) => k as string)
  return f.founderReachableEmailLi ? [] : ['founder+email+linkedin']
}

// ── Stage derivation (highest evidence-backed stage) ──────────────────────────
export interface FunnelSignals {
  covered: boolean
  outreachSent: boolean
  replied: boolean
  sampleRequested: boolean   // reply intent = sample, or a sample row in 'requested'
  sampleSent: boolean
  quoted: boolean
  trialOrder: boolean
  scaleOrder: boolean
}

export function deriveFunnelStage(s: FunnelSignals): FunnelStage {
  if (s.scaleOrder) return 'scale_order'
  if (s.trialOrder) return 'trial_order'
  if (s.quoted) return 'quotation'
  if (s.sampleSent) return 'sample_sent'
  if (s.sampleRequested) return 'sample_requested'
  if (s.replied) return 'replied'
  if (s.outreachSent) return 'outreach_sent'
  if (s.covered) return 'contact_captured'
  return 'discovered'
}

// ── Sample-first: what sample to offer ────────────────────────────────────────
export function sampleOffer(wedge?: string | null, category?: string | null): string {
  const w = (wedge ?? '').toLowerCase()
  if (w.includes('seamless')) return '无缝套装/打底样 (seamless set)'
  if (w.includes('plus')) return '加大码试身样 (plus-size fit-test, 1X–4X)'
  if (w.includes('flare')) return '喇叭裤样 (flare legging)'
  if (w.includes('organic') || w.includes('recycled')) return '可持续面料样 (GRS/organic swatch + 成衣)'
  if (w.includes('fast')) return '7天快打样 spec sample'
  return `对标其核心款的 spec sample${category ? `（${category}）` : ''}`
}

// ── Follow-up cadence: Day 0/4/9/15/30 ────────────────────────────────────────
const CADENCE = [0, 4, 9, 15, 30]
/** Given days since last outreach, what follow-up is due (1-based), or null. */
export function followUpDue(daysSinceSent: number): { step: number; label: string } | null {
  for (let i = 1; i < CADENCE.length; i++) {
    if (daysSinceSent >= CADENCE[i]) {
      // due if we've passed this checkpoint and not yet the next
      if (i === CADENCE.length - 1 || daysSinceSent < CADENCE[i + 1]) {
        return { step: i, label: i < CADENCE.length - 1 ? `跟进#${i}` : '激活(Day30)' }
      }
    }
  }
  return null
}
export function nextCadenceDay(daysSinceSent: number): number | null {
  for (const d of CADENCE) if (daysSinceSent < d) return d
  return null
}

// ── Conversion probabilities (heuristic, stage × engage signal) ───────────────
/** engageProb 0-100 = the account's sample-probability signal (phase 1.5). */
export function probabilities(stage: FunnelStage, engageProb = 50): { sample: number; quote: number; po: number } {
  const e = Math.max(0, Math.min(100, engageProb)) / 100
  const TBL: Record<FunnelStage, [number, number, number]> = {
    discovered: [Math.round(8 * e), Math.round(4 * e), Math.round(2 * e)],
    contact_captured: [Math.round(40 * e + 10), Math.round(18 * e + 4), Math.round(8 * e + 2)],
    outreach_sent: [Math.round(34 * e + 8), Math.round(15 * e + 3), Math.round(7 * e + 1)],
    replied: [65, 38, 20],
    sample_requested: [92, 52, 30],
    sample_sent: [100, 62, 40],
    quotation: [100, 100, 58],
    trial_order: [100, 100, 100],
    scale_order: [100, 100, 100],
  }
  const [sample, quote, po] = TBL[stage]
  return { sample, quote, po }
}

// ── The one required action today ─────────────────────────────────────────────
export interface ActionCtx {
  dmName?: string | null
  offer: string
  daysSinceSent?: number | null
  hasDraft?: boolean
}
export function requiredActionToday(stage: FunnelStage, ctx: ActionCtx): string {
  switch (stage) {
    case 'discovered': return '抓决策人(Apollo/LinkedIn)至达标覆盖'
    case 'contact_captured': return ctx.hasDraft
      ? `发样品邀约（草稿已就绪）给 ${ctx.dmName ?? 'DM'} — offer: ${ctx.offer}`
      : `起草并发样品邀约给 ${ctx.dmName ?? 'DM'} — offer: ${ctx.offer}`
    case 'outreach_sent': {
      const d = ctx.daysSinceSent ?? 0
      const due = followUpDue(d)
      const next = nextCadenceDay(d)
      return due ? `发${due.label}（距上次 ${d} 天）— 再提样品 offer` : `等回复（下次跟进 Day ${next ?? '—'}）`
    }
    case 'replied': return `🔥 24h 内回复 → 直接提样品: ${ctx.offer}；要收件地址`
    case 'sample_requested': return `确认地址 + 寄样 ${ctx.offer}；录入 samples`
    case 'sample_sent': return '催样品反馈 → 推报价'
    case 'quotation': return '发/催报价 → 推首单(trial)'
    case 'trial_order': return '服务好首单 → 推返单/放量'
    case 'scale_order': return '维护 + 扩品类/扩量'
  }
}
