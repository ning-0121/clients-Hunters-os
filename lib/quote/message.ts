/**
 * Quote message composer (Quote Intelligence P1 #5 — "复制报价话术").
 *
 * Turns the internal quote strategy into a professional, customer-readable quote
 * note. Mirrors lib/outreach/compose.ts style. CRITICAL guardrails:
 *   - It is a DRAFT for the salesperson to review/copy — NEVER auto-sent.
 *   - It NEVER reveals internal numbers: cost, floor/strategic margin, any
 *     margin %, or any score. Only the customer-facing recommended price RANGE
 *     (and only if the seller profile allows mentioning price).
 *   - It NEVER promises free samples (sample terms are added manually) and never
 *     fabricates certifications/capabilities.
 */
import { callLLMSimple } from '@/lib/llm/client'

const SYSTEM = `你是 QIMO / Jojofashion 的资深外贸 BD（中国运动服 OEM/ODM 工厂；Jojofashion 是其外贸品牌，网站 jojofashion.us）。
把内部报价策略改写成一段**给客户看的**专业报价说明（不是内部分析、不是开发信开场白）。严格遵守：

【价值优先】先用一两句讲清我们能带来的价值（按"可引用卖点"挑最相关的：低起订量/自有设计打版/快返单/品质），再谈价格——不要只甩数字。
【价格表述】
  - 若「是否提价格」为否：不要写任何具体价格/数字，用"可按款式与数量细化报价，欢迎进一步沟通"这类表述。
  - 若为是：给出**推荐报价区间**（每件 $low–$high @ 指定数量），并说明随数量上升可优化；不要写"最低价/底价"。
【绝密红线】绝不出现任何内部信息：成本、底线利润、战略利润、利润率/百分比、任何评分、"floor/target/strategic"等字样。一个数字都不许泄露成本或利润。
【样品】不要在话术里承诺免费样品或具体样品费——样品条款由业务员另行人工补充。最多说"样品事宜可另行沟通"。
【真实性】只能提真实卖点，不得编造认证/产能。
【风格】按 language 语言书写；像真人、地道、专业、不油腔；不超过 160 词；禁止 "I hope this finds you well""synergy"等套话；结尾用一句自然的行动邀约；用给定署名结尾。
【性质】这是给业务员复制参考的草稿，不代表已向客户做出任何承诺。

只返回报价说明正文（纯文本，可含换行），不要解释、不要加引号、不要加 markdown。`

export interface QuoteMessageContext {
  companyName: string
  contactName?: string | null
  contactTitle?: string | null
  country?: string | null
  categoryLabel: string
  qty: number
  lang: string
  // price (only used when mentionPrice = true)
  mentionPrice: boolean
  priceLow?: number | null
  priceHigh?: number | null
  // seller profile (from onboarding)
  mentionMoq: boolean
  moq?: number | null
  companyIntro?: string
  sellingPoints?: string[]
  toneLabel?: string
  signature?: string
  ctaPreference?: string
  salesFocusDirective?: string
}

export async function composeQuoteMessage(ctx: QuoteMessageContext, feedback?: string): Promise<string | null> {
  const priceLine = ctx.mentionPrice && ctx.priceLow && ctx.priceHigh
    ? `推荐报价区间（可写给客户）：每件 $${ctx.priceLow}–$${ctx.priceHigh} @ ${ctx.qty} 件；随量可优化。`
    : '是否提价格：否 → 不要写具体价格数字。'

  const user = `客户：${ctx.companyName}${ctx.country ? `（${ctx.country}）` : ''}
决策人：${ctx.contactName ?? '未知'}（${ctx.contactTitle ?? '职位未知'}）
报价品类：${ctx.categoryLabel}　数量：${ctx.qty}
${priceLine}
是否可提起订量(MOQ)：${ctx.mentionMoq ? `可以（${ctx.moq ?? 50} 件/款起）` : '不要提'}

=== 我方设定（务必遵守）===
${ctx.salesFocusDirective ? `主推方向：${ctx.salesFocusDirective}` : ''}
公司简介：${ctx.companyIntro ?? '中国运动服 OEM/ODM 工厂'}
可引用卖点（只能用这些）：${ctx.sellingPoints?.length ? ctx.sellingPoints.join('；') : '低起订量、自有设计打版、快返单'}
语气：${ctx.toneLabel ?? '专业稳重'}
行动邀约偏好：${ctx.ctaPreference ?? '约 15 分钟电话或发详细报价单'}
署名：${ctx.signature ?? 'Alex / Jojofashion / jojofashion.us'}

报价说明语言(language)：${ctx.lang}
${feedback ? `\n【调整要求】业务员对上一版不满意，请按此重写：${feedback}` : ''}

只返回报价说明正文（${ctx.lang}），纯文本。`

  try {
    const raw = await callLLMSimple(SYSTEM, user, { maxTokens: 700, temperature: 0.6 })
    const text = (raw ?? '').trim().replace(/^```[a-z]*\n?|\n?```$/g, '').trim()
    return text || null
  } catch (err) {
    console.error('[composeQuoteMessage]', err)
    return null
  }
}
