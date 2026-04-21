import { callLLMSimple } from '@/lib/llm/client'

export interface ICPFilterInput {
  name: string
  domain: string
  description: string
  bodyText: string
  source: string
  website?: string
  instagramHandle?: string
  tiktokHandle?: string
  linkedinUrl?: string
  shopifyDetected?: boolean
  emails?: string[]
}

export interface ICPFilterResult {
  isICP: boolean
  companyType: string
  productCategories: string[]
  pricePoint: string
  hasSourcingNeed: boolean
  employeeCountRange: string
  reasoning: string
  confidence: number
}

const ICP_SYSTEM_PROMPT = `You are an expert analyst for a Chinese activewear OEM/ODM factory.
Your job is to evaluate if a company is a good prospect.

TARGET CUSTOMERS:
- Small to mid-size activewear / sportswear / yoga / tennis / golf / athleisure brands
- DTC brands selling online (own website, Amazon, TikTok Shop, Shopify)
- Private label / white label buyers
- Wholesalers and distributors of activewear
- Amazon FBA sellers in athletic apparel
- TikTok Shop sellers of activewear

NOT GOOD TARGETS:
- Large enterprises (Nike, Adidas, Under Armour, Lululemon, etc.) — too big
- Non-apparel companies
- Luxury fashion (not activewear)
- B2B software companies
- Retailers that don't source directly (just resellers)

Return ONLY valid JSON, no markdown.`

export async function filterByICP(companies: ICPFilterInput[]): Promise<
  Array<ICPFilterInput & { icpResult: ICPFilterResult }>
> {
  const results = await Promise.allSettled(
    companies.map(async (company) => {
      const result = await evaluateSingleCompany(company)
      return { ...company, icpResult: result }
    })
  )

  return results
    .filter((r): r is PromiseFulfilledResult<ICPFilterInput & { icpResult: ICPFilterResult }> =>
      r.status === 'fulfilled' && r.value.icpResult.isICP
    )
    .map((r) => r.value)
}

async function evaluateSingleCompany(company: ICPFilterInput): Promise<ICPFilterResult> {
  const userMessage = `Evaluate this company as a prospect:

Name: ${company.name}
Domain: ${company.domain}
Description: ${company.description}
Website text sample: ${company.bodyText.slice(0, 1500)}
Found via: ${company.source}

Return JSON:
{
  "isICP": true/false,
  "companyType": "activewear_brand|dtc_brand|amazon_seller|tiktok_seller|wholesaler|private_label|other",
  "productCategories": ["yoga", "sportswear", "athleisure", etc],
  "pricePoint": "budget|mid|premium|luxury|unknown",
  "hasSourcingNeed": true/false,
  "employeeCountRange": "1-10|11-50|51-200|201-500|500+|unknown",
  "reasoning": "1 sentence why this is or isn't a good target",
  "confidence": 0.0-1.0
}`

  try {
    const raw = await callLLMSimple(ICP_SYSTEM_PROMPT, userMessage, {
      maxTokens: 400,
      temperature: 0.2,
    })
    return JSON.parse(raw) as ICPFilterResult
  } catch {
    return {
      isICP: false,
      companyType: 'unknown',
      productCategories: [],
      pricePoint: 'unknown',
      hasSourcingNeed: false,
      employeeCountRange: 'unknown',
      reasoning: 'Failed to evaluate',
      confidence: 0,
    }
  }
}
