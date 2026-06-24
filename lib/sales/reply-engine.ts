/**
 * Reply Engine — the only question that matters: why is there no reply, and what
 * single action most increases the probability of a sample → quote → PO.
 *
 * No discovery, no scoring, no ranking. Just: for every sent email, track the
 * funnel-critical fields + classify WHY NO REPLY, then surface the bottleneck and
 * the highest-probability next action.
 */

export type CtaType = 'sample' | 'comparison' | 'problem_solving' | 'call' | 'soft_weak' | 'other'

export function ctaType(body: string): CtaType {
  const b = (body || '').toLowerCase()
  if (/would that be useful|useful\?|worth a quick look|thoughts\?|let me know|happy to discuss/.test(b)) return 'soft_weak'
  if (/comparison sample|against your current/.test(b)) return 'comparison'
  if (/ship.?to address|shipping address|send (you )?a .*sample|send a .*sample|sample set this week|fit-test sample/.test(b)) return 'sample'
  if (/15.?min|sourcing call|quick call/.test(b)) return 'call'
  if (/which|what|how do you|biggest (bottleneck|pain)/.test(b)) return 'problem_solving'
  return 'other'
}

export const WHY_NO_REPLY = ['replied', 'wrong_contact', 'wrong_wedge', 'weak_cta', 'timing', 'no_need', 'existing_supplier', 'not_seen', 'unknown'] as const
export type WhyNoReply = (typeof WHY_NO_REPLY)[number]
export const WHY_LABEL: Record<WhyNoReply, string> = {
  replied: '已回复', wrong_contact: 'Wrong Contact(邮箱无效/非DM)', wrong_wedge: 'Wrong Wedge',
  weak_cta: 'Weak CTA', timing: 'Timing(太早,跟进未到)', no_need: 'No Need',
  existing_supplier: 'Existing Supplier', not_seen: 'Not Seen(未追踪开信)', unknown: 'Unknown',
}

export interface ReplySignals {
  replied: boolean
  bounced: boolean
  daysSinceSent: number | null
  ctaType: CtaType
  hasIncumbentSupplier: boolean
  followUpDone: boolean   // has at least one follow-up been sent?
}

/**
 * Classify why there is no reply — every follow-up should reduce this uncertainty.
 * Order matters: hard facts first (bounce), then "too early" (timing), then the
 * weakest controllable lever (CTA), then context, then unknown.
 */
export function classifyWhyNoReply(s: ReplySignals): WhyNoReply {
  if (s.bounced) return 'wrong_contact'                 // a bounce is NOT a reply — dead/bad address first
  if (s.replied) return 'replied'
  if (s.daysSinceSent != null && s.daysSinceSent < 4 && !s.followUpDone) return 'timing' // before Day-4 follow-up
  if (s.ctaType === 'soft_weak') return 'weak_cta'      // a controllable miss
  if (s.hasIncumbentSupplier) return 'existing_supplier'
  if (s.followUpDone) return 'no_need'                  // followed up, still silent → likely no current need
  return 'unknown'                                       // no open tracking → genuinely unknown
}

/** The single highest-probability action to move toward a sample, given the why. */
export function nextActionFor(why: WhyNoReply, ctx: { offer: string; followUpStep?: number }): string {
  switch (why) {
    case 'replied': return `回复中 → 直接提样品: ${ctx.offer}; 要收件地址`
    case 'wrong_contact': return '换邮箱: Apollo/验证重找该公司 DM 的可达邮箱, 再发'
    case 'timing': return `等到 Day-4 → 发跟进#1(sample-first CTA): ${ctx.offer}`
    case 'weak_cta': return `重发/跟进改用强 CTA: ${ctx.offer}`
    case 'existing_supplier': return `跟进打"对比/备胎"角度: 寄对比样 vs 现供应商, 卡补单/旺季缺口`
    case 'no_need': return '降频; Day-15/30 用新钩子(上新季/新面料)激活'
    case 'not_seen': return '换主题行 + 换时段重发'
    case 'unknown': return `发跟进, 单一问题降不确定性: "${ctx.offer}"`
    case 'wrong_wedge': return '换 wedge: 对标其在售核心款重定样品角度'
  }
}
