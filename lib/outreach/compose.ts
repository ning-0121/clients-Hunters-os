/**
 * Outreach "studio" composer: produces BOTH a sales-facing match analysis
 * (our capability × this client) AND the client-facing email, from collected
 * data (enrichment + customs + Apollo + product match + our real factory caps).
 * Supports a feedback note for "regenerate with adjustments".
 */
import { callLLMSimple } from '@/lib/llm/client'
import { parseJsonWithRepair } from '@/lib/llm/json'

const SYSTEM = `你是 QIMO / Jojofashion 的资深外贸 BD。QIMO 是中国运动服 OEM/ODM 工厂
（运动服、瑜伽服、leggings、运动内衣、无缝、卫衣套装、家居服等），50 件起订、自有设计、
30-45 天返单。你要基于"我方真实产能/认证"与"客户采集到的信息"做匹配，产出两部分：

1) analysis（中文，给我方销售看的内部分析，不发给客户）：
   - 我方哪些产能/认证正好匹配该客户的品类
   - 客户现状/现有供应商/痛点（如有海关数据则引用）
   - 最强切入点与建议策略；如果匹配度低，要诚实指出风险
2) 一封给客户的开发信（按 language 字段的语言写）：subject + body
   - 基于上面的分析，自然地引用：决策人名字（如有）、现有供应商/进口国（如有）、
     一个具体推荐产品（不要泛泛说"we make activewear"）
   - < 150 词，口语、不群发感，署名 Alex，不要用 "I hope this finds you well"

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
