/**
 * Product & supply-chain fit — reuses the existing structured `product_match`,
 * then infers fabric/construction/FOB/factory/sourcing from visible categories.
 */
import type { CompanyFacts, CustomerType, Complexity, ProductSupplyFit } from '@/lib/intel/types'

const FABRIC_RULES: [RegExp, string][] = [
  [/seamless/, '无缝针织(尼龙/氨纶)'],
  [/legging|biker|short|sports bra|bra|active|yoga/, '尼龙/氨纶、聚酯/氨纶(四面弹)'],
  [/fleece|hoodie|sweat|jogger|tracksuit/, '棉/聚酯抓绒、法式毛圈'],
  [/tee|t-shirt|top|tank/, '棉/莫代尔/聚酯针织'],
  [/swim|bikini/, '聚酯/氨纶(抗氯)'],
  [/jacket|outerwear|windbreaker/, '尼龙梭织、复合面料'],
]

const COMPLEXITY_RULES: [RegExp, Complexity][] = [
  [/seamless|compression|technical|bonded|laser/, 'high'],
  [/set|tracksuit|jacket|outerwear|bra|reflective|cut.?and.?sew/, 'medium'],
  [/tee|t-shirt|tank|short|legging|jogger|basic/, 'low'],
]

const AVOID_RE = /footwear|shoe|sneaker|accessor|bag|hard goods|denim|jeans|suit|formal|leather|electronics/

/** Rough FOB band (USD/pc) by complexity, nudged by price sensitivity of the type. */
function fobRange(complexity: Complexity, type: CustomerType): string {
  const base: Record<Complexity, [number, number]> = { low: [4, 8], medium: [7, 13], high: [11, 20] }
  let [lo, hi] = base[complexity]
  if (type === 'off_price_discount' || type === 'wholesale_trade' || type === 'distributor_importer') { lo = Math.max(3, lo - 1); hi = hi - 2 }
  if (type === 'premium_dtc') { lo += 1; hi += 4 }
  return `$${lo}-${hi} FOB`
}

export function productSupplyFit(c: CompanyFacts, type: CustomerType): ProductSupplyFit {
  const cats = (c.productCategories ?? [])
  const catsText = cats.join(' ').toLowerCase()
  const matches = (c.productMatch ?? [])

  const highMatches = matches.filter((m) => (m.level ?? '').toLowerCase() === 'high')
  const cutInProducts = (highMatches.length ? highMatches : matches)
    .map((m) => m.suggested_qimo_product || m.category)
    .filter((v): v is string => !!v).slice(0, 4)

  const coreCategories = (matches.map((m) => m.category).filter((v): v is string => !!v).length
    ? matches.map((m) => m.category).filter((v): v is string => !!v)
    : cats).slice(0, 5)

  const fabricTypes = Array.from(new Set(FABRIC_RULES.filter(([re]) => re.test(catsText)).map(([, f]) => f)))
  if (!fabricTypes.length) fabricTypes.push('针织为主(需确认)')

  const complexity: Complexity = COMPLEXITY_RULES.find(([re]) => re.test(catsText))?.[1] ?? 'medium'

  // QIMO fit: prefer existing product_match_score; else derive from High-match count.
  const qimoFitScore = c.productMatchScore != null
    ? Math.round(Math.max(0, Math.min(10, c.productMatchScore)) * 10)
    : Math.min(100, highMatches.length * 30 + matches.length * 5)

  const productsToAvoid: string[] = []
  for (const cat of cats) if (AVOID_RE.test(cat.toLowerCase())) productsToAvoid.push(cat)
  if (complexity === 'high' && (type === 'off_price_discount' || type === 'ecom_micro')) {
    productsToAvoid.push('高难度无缝/技术款(与该客户的低价/小单不匹配)')
  }

  const factoryRequirement =
    complexity === 'high' ? '需无缝/技术针织产能(无缝机/压胶)'
    : complexity === 'medium' ? '裁剪缝制(cut-and-sew)+ 抓绒/套装产能'
    : '基础针织裁缝产能即可'

  const likelySourcingCountry = type === 'premium_dtc' ? '中国为主,部分高端考虑越南/葡萄牙' : '中国(成本与产能优势)'

  const switchingDifficulty: Complexity =
    type === 'off_price_discount' || type === 'ecom_micro' ? 'low'
    : type === 'retail_private_label' || type === 'premium_dtc' ? 'high'
    : 'medium'

  return {
    coreCategories,
    fabricTypes,
    constructionComplexity: complexity,
    qimoFitScore,
    cutInProducts: cutInProducts.length ? cutInProducts : ['需先确认其在售核心款'],
    productsToAvoid,
    targetFobRange: fobRange(complexity, type),
    factoryRequirement,
    likelySourcingCountry,
    switchingDifficulty,
  }
}
