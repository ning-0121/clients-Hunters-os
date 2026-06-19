/**
 * Outreach "studio" composer: produces BOTH a sales-facing match analysis
 * (our capability × this client) AND the client-facing email, from collected
 * data (enrichment + customs + Apollo + product match + our real factory caps).
 * Supports a feedback note for "regenerate with adjustments".
 */
import { callLLMSimple } from '@/lib/llm/client'
import { parseJsonWithRepair } from '@/lib/llm/json'

const SYSTEM = `你是 QIMO / Jojofashion 的资深外贸 BD（母公司 Qimo Clothing，中国运动服 OEM/ODM 工厂；
Jojofashion 是其外贸/国际销售品牌，网站 jojofashion.us）。产出两部分：

1) analysis（中文，给我方销售看的内部分析，不发客户）：
   - 我方哪些产能/认证正好匹配该客户的品类
   - 客户现状/现有供应商/痛点（如有海关数据则引用）
   - 最强切入点与建议策略；匹配度低要诚实指出风险

2) 一封给客户的开发信（按 language 写）：subject + body。严格遵守：
   - 【真实性】**只能提我方"真实产能/认证"里列出的认证**。没列的认证（如 GOTS、OEKO、BSCI 等）
     **绝对不能写**——宁可不提认证，也不许编造。BSCI/WRAP 若是"续证中/过期"，不要当成"有效认证"来吹。
   - 【自我介绍】开头一句简短自我介绍：我们是谁（一家专做运动服的中国 OEM/ODM 工厂），不要上来就推销。
   - 【具体】引用决策人名字（如有）、对方现有供应商/进口国（如有）、一个具体推荐产品（不要泛泛 "we make activewear"）。
   - 【价值点】自然带出一个实在卖点：起订量低（50 件/款起）、自有设计打版、30-45 天返单——挑最相关的一个，别堆。
   - 【英文质量】像真人写的、地道、专业、口语但不油腔。**禁止** "I hope this finds you well"、"Worth a look?"、
     "Just circling back"、"synergy"、夸张感叹号、群发感套话。结尾用自然的一句行动邀约（如约个 15 分钟电话 / 发份资料）。
   - 【反垃圾过滤】避免垃圾邮件触发词（free / guarantee / act now / limited time / click here / buy now / 100% /
     全大写词 / "!!!"）；最多 1 个链接；不堆价格与百分比；不要 "Dear friend/Sir" 群发称呼。写得越像一对一的人写的越好。
   - 长度 < 140 词。署名 Alex / Jojofashion / jojofashion.us。

只返回合法 JSON：{"analysis":"...","subject":"...","body":"..."}`

export interface ComposedOutreach {
  analysis: string
  subject: string
  body: string
}

export interface ComposeContext {
  companyName: string
  website?: string | null
  country?: string | null
  categories?: string[] | null
  description?: string | null
  tier?: string | null
  productMatch?: Array<{ category?: string; level?: string; suggested_sku?: string; reason?: string }>
  currentSuppliers?: string[]
  customsSnippet?: string
  contactName?: string | null
  contactTitle?: string | null
  ourCapabilities?: string  // summary of QIMO factory strong categories + cert status
  lang?: string
  /** From onboarding — shapes WHAT we pitch and HOW the email reads. */
  seller?: {
    salesFocusDirective?: string
    companyIntro?: string
    sellingPoints?: string[]
    targetPreferences?: string
    toneLabel?: string
    mentionMoq?: boolean
    mentionPrice?: boolean
    signature?: string
    ctaPreference?: string
  }
}

export async function composeOutreach(ctx: ComposeContext, feedback?: string): Promise<ComposedOutreach | null> {
  const pm = (ctx.productMatch ?? []).map((p) => `${p.category}(${p.level ?? '?'}${p.suggested_sku ? ' → ' + p.suggested_sku : ''})`).join('; ')
  const user = `客户信息：
公司：${ctx.companyName}
网站：${ctx.website ?? '未知'} | 国家：${ctx.country ?? '未知'} | 我方层级评估：${ctx.tier ?? '未分级'}
品类：${ctx.categories?.join('、') ?? '未知'}
简介：${ctx.description ?? '无'}
产品匹配：${pm || '未分析'}
现有供应商（海关）：${ctx.currentSuppliers?.length ? ctx.currentSuppliers.join('、') : '未知'}
海关摘要：${ctx.customsSnippet?.slice(0, 280) || '无'}
决策人：${ctx.contactName ?? '未知'}（${ctx.contactTitle ?? '职位未知'}）

我方（QIMO）真实产能/认证：
${ctx.ourCapabilities ?? '运动服/瑜伽服/无缝/leggings 强项；BSCI/WRAP 续证中、OEKO 有效'}
${ctx.seller ? `
=== 我方设定（务必遵守）===
${ctx.seller.salesFocusDirective ? `主推方向：${ctx.seller.salesFocusDirective}` : ''}
公司简介（自我介绍用）：${ctx.seller.companyIntro ?? ''}
可引用的卖点（只能用这些，别编）：${ctx.seller.sellingPoints?.length ? ctx.seller.sellingPoints.join('；') : '低起订量、自有设计打版、快返单'}
目标客户偏好：${ctx.seller.targetPreferences || '无特别偏好'}
语气：${ctx.seller.toneLabel ?? '专业稳重'}
是否提起订量(MOQ)：${ctx.seller.mentionMoq ? '可以提（50件/款起）' : '不要提'}
是否提价格：${ctx.seller.mentionPrice ? '可以给个区间' : '不要提具体价格'}
行动邀约(CTA)偏好：${ctx.seller.ctaPreference ?? '约15分钟电话'}
署名：${ctx.seller.signature ?? 'Alex / Jojofashion / jojofashion.us'}` : ''}

开发信语言(language)：${ctx.lang ?? 'en'}
${feedback ? `\n【调整要求】销售对上一版不满意，请按此重写：${feedback}` : ''}

返回 JSON：{"analysis":"中文内部分析","subject":"邮件主题","body":"邮件正文(${ctx.lang ?? 'en'})"}`

  try {
    const raw = await callLLMSimple(SYSTEM, user, { maxTokens: 1400, temperature: 0.6 })
    const r = parseJsonWithRepair<ComposedOutreach>(raw)
    if (r.ok && r.value?.body) return r.value
    return null
  } catch (err) {
    console.error('[composeOutreach]', err)
    return null
  }
}
