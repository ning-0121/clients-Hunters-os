import { callLLMSimple } from '@/lib/llm/client'

export interface DomesticFilterInput {
  name: string
  domain: string
  snippet: string
  bodyText: string
}

export interface DomesticClassification {
  isDomesticTarget: boolean
  domesticCompanyType: string   // apparel_trading_company | activewear_trading_company | general_import_export_company | cross_border_ecommerce_seller | sourcing_agent | factory_with_export_department | software_prospect
  mainCategories: string[]
  region: string                // 义乌 / 杭州 / 宁波 / 广州 / 深圳 / 上海 / ...
  painSignals: string[]
  recruitmentSignals: string[]
  reasoning: string
}

const SYSTEM_PROMPT = `你是 QIMO 的国内市场分析师。判断一家公司是否是「国内服装/运动服外贸或贸易公司」，
即我们可以发展为（1）订单/渠道合作伙伴 或（2）外贸软件客户 的目标。
只返回 JSON，不要 markdown。`

export async function classifyDomesticCompany(input: DomesticFilterInput): Promise<DomesticClassification> {
  const text = input.bodyText?.trim().length > 80 ? input.bodyText.slice(0, 1500) : input.snippet
  const userMessage = `判断这家公司是否为国内服装/运动服外贸或贸易公司目标：

名称：${input.name}
域名：${input.domain}
搜索摘要：${input.snippet}
网站文本：${text}

domestic_company_type 只能取：
"apparel_trading_company" | "activewear_trading_company" | "general_import_export_company" |
"cross_border_ecommerce_seller" | "sourcing_agent" | "factory_with_export_department" | "software_prospect"

返回 JSON：
{
  "isDomesticTarget": true/false,
  "domesticCompanyType": "...",
  "mainCategories": ["运动服","瑜伽服","leggings",...],
  "region": "如 义乌 / 杭州 / 宁波 / 广州 / 深圳 / 上海，未知则空字符串",
  "painSignals": ["如 订单跟单混乱"],
  "recruitmentSignals": ["如 招聘外贸跟单"],
  "reasoning": "一句话理由"
}`

  try {
    const raw = await callLLMSimple(SYSTEM_PROMPT, userMessage, { maxTokens: 400, temperature: 0.2 })
    const cleaned = raw.replace(/```(?:json)?\s*([\s\S]*?)```/, '$1').trim()
    const parsed = JSON.parse(cleaned) as Partial<DomesticClassification>
    return {
      isDomesticTarget:    !!parsed.isDomesticTarget,
      domesticCompanyType: parsed.domesticCompanyType ?? 'apparel_trading_company',
      mainCategories:      Array.isArray(parsed.mainCategories) ? parsed.mainCategories : [],
      region:              parsed.region ?? '',
      painSignals:         Array.isArray(parsed.painSignals) ? parsed.painSignals : [],
      recruitmentSignals:  Array.isArray(parsed.recruitmentSignals) ? parsed.recruitmentSignals : [],
      reasoning:           parsed.reasoning ?? '',
    }
  } catch (err) {
    console.error(`[DomesticFilter] Failed for ${input.domain}:`, err)
    return {
      isDomesticTarget: false, domesticCompanyType: 'apparel_trading_company',
      mainCategories: [], region: '', painSignals: [], recruitmentSignals: [], reasoning: 'parse error',
    }
  }
}
