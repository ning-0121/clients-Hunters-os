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

// QIMO is an activewear ODM — these categories ARE our core. A brand selling them
// is a strong fit by definition; we never report "0" for an activewear brand.
const QIMO_STRONG_RE = /seamless|legging|yoga|sports?\s*bra|\bbra\b|activewear|athleis|compression|biker|gym/
const QIMO_CORE_RE   = /short|fleece|hoodie|sweat|jogger|tracksuit|tank|tee|t-shirt|top|set|swim|active|sport/

// Country names that may appear in customs snippets — for evidence-based sourcing.
const COUNTRY_RE = /\b(china|vietnam|bangladesh|india|cambodia|indonesia|turkey|pakistan|portugal|sri lanka|taiwan|thailand|myanmar)\b/gi

/**
 * QIMO fit, evidence-first. Prefer a real product_match_score; otherwise derive
 * from category overlap with QIMO's core. Returns -1 ("待确认") only when there is
 * NO category signal at all — never a misleading 0 for a matching brand.
 */
function deriveFit(catsText: string, productMatchScore: number | null | undefined, matchCount: number): number {
  if (productMatchScore != null && productMatchScore > 0) {
    return Math.round(Math.max(0, Math.min(10, productMatchScore)) * 10)
  }
  if (!catsText.trim() && !matchCount) return -1 // unknown — show 待确认, not 0
  const strong = QIMO_STRONG_RE.test(catsText)
  const core = QIMO_CORE_RE.test(catsText)
  const offOnly = AVOID_RE.test(catsText) && !strong && !core
  if (offOnly) return 25
  if (strong) return 85
  if (core) return 65
  return 45 // apparel-ish but unclear overlap
}

const ISO_ZH: Record<string, string> = {
  CN: '中国', VN: '越南', BD: '孟加拉', IN: '印度', KH: '柬埔寨', ID: '印尼', TR: '土耳其',
  PK: '巴基斯坦', PT: '葡萄牙', LK: '斯里兰卡', TW: '中国台湾', TH: '泰国', MM: '缅甸', HK: '中国香港',
}
const NAME_ZH: Record<string, string> = { china: '中国', vietnam: '越南', bangladesh: '孟加拉', india: '印度', cambodia: '柬埔寨', indonesia: '印尼', turkey: '土耳其', pakistan: '巴基斯坦', portugal: '葡萄牙', 'sri lanka': '斯里兰卡', taiwan: '中国台湾', thailand: '泰国', myanmar: '缅甸' }

/**
 * Sourcing origin from EVIDENCE (customs records), never a guess. Prefer the ISO
 * origin countries pulled from ImportYeti; fall back to parsing customs text;
 * otherwise say UNKNOWN with the path. We never default to "中国".
 */
function sourcingFromCustoms(customsOrigins: string[] | undefined, customsText: string | null | undefined): string {
  if (customsOrigins && customsOrigins.length) {
    return `海关记录原产国:${customsOrigins.map((c) => ISO_ZH[c] ?? c).join('、')}`
  }
  if (!customsText) return '未知 — 需海关数据确认(当前无进口记录)'
  const hits = Array.from(new Set((customsText.match(COUNTRY_RE) ?? []).map((s) => s.toLowerCase())))
  if (!hits.length) return '有海关记录但未解析出原产国 — 见下方原始证据'
  return `海关记录显示:${hits.map((h) => NAME_ZH[h] ?? h).join('、')}`
}

/** Factory requirement = 验厂(compliance) + 工艺(process) — not "cut-and-sew tailoring". */
function factoryRequirement(complexity: Complexity, complianceRequirements: string[], complianceLevel: string | null | undefined): string {
  const process =
    complexity === 'high' ? '无缝/技术针织(无缝机、压胶、四面弹)'
    : complexity === 'medium' ? '中等工艺(套装、抓绒、贴标缝制)'
    : '基础针织工艺'
  const COMPLY_ZH: Record<string, string> = {
    none: '无需验厂', basic_docs: '基础资质文件', bsci_wrap: 'BSCI/WRAP', sedex_smeta: 'Sedex/SMETA',
    oeko_grs: 'OEKO-TEX/GRS', customer_audit: '客户自有验厂', supplier_portal: '供应商门户注册',
  }
  const audit = complianceRequirements.length
    ? complianceRequirements.join('、')
    : complianceLevel
      ? (COMPLY_ZH[complianceLevel] ?? complianceLevel)
      : '验厂要求未知 — 需确认(BSCI/SMETA/客户审厂?)'
  return `验厂:${audit} · 工艺:${process}`
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

  const qimoFitScore = deriveFit(catsText, c.productMatchScore, matches.length)

  const productsToAvoid: string[] = []
  for (const cat of cats) if (AVOID_RE.test(cat.toLowerCase())) productsToAvoid.push(cat)
  if (complexity === 'high' && (type === 'off_price_discount' || type === 'ecom_micro')) {
    productsToAvoid.push('高难度无缝/技术款(与该客户的低价/小单不匹配)')
  }

  const switchingDifficulty: Complexity =
    type === 'off_price_discount' || type === 'ecom_micro' ? 'low'
    : type === 'retail_private_label' || type === 'premium_dtc' ? 'high'
    : 'medium'

  // FOB price must be EVIDENCE, not a complexity guess. Without customs unit
  // values or a quote, we say UNKNOWN — and flag the FOB-vs-DDP gap explicitly,
  // because incoterm changes the number entirely (e.g. ~FOB $3 vs DDP landed).
  const targetFobRange = c.customsEvidence
    ? '以海关申报均价为准(见下方原始证据)— 务必确认 FOB/DDP 口径'
    : '未知 — 需海关数据或打样询价(FOB vs DDP 口径未证实,勿臆测)'

  return {
    coreCategories,
    fabricTypes,
    constructionComplexity: complexity,
    qimoFitScore,
    cutInProducts: cutInProducts.length ? cutInProducts : ['需先确认其在售核心款'],
    productsToAvoid,
    targetFobRange,
    factoryRequirement: factoryRequirement(complexity, c.complianceRequirements ?? [], c.complianceLevel),
    likelySourcingCountry: sourcingFromCustoms(c.customsOrigins, c.customsText),
    switchingDifficulty,
  }
}
