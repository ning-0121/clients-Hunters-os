/**
 * Customer type classification — deterministic, from product/price/channel/size.
 * Each type carries a static behavior profile that drives the contact, risk, and
 * winning-strategy sections. Ordered rules (most-specific first); the last rule
 * (growth activewear) is the default for an apparel DTC brand.
 */
import type { CompanyFacts, CustomerType, CustomerTypeProfile, Sensitivity } from '@/lib/intel/types'

interface StaticProfile {
  label: string
  buyingBehavior: string
  priceSensitivity: Sensitivity
  qualitySensitivity: Sensitivity
  developmentNeeds: string
  likelyDecisionMaker: string
  bestApproach: string
}

export const TYPE_PROFILES: Record<CustomerType, StaticProfile> = {
  premium_dtc: {
    label: '高端 DTC 品牌',
    buyingBehavior: '小单多款、重设计与面料、看重供应商配合度与一致性,愿为质量付费',
    priceSensitivity: 'low', qualitySensitivity: 'high',
    developmentNeeds: '强:打样开发、面料创新、独特工艺',
    likelyDecisionMaker: 'Head/Director of Product 或 Sourcing;小品牌为创始人',
    bestApproach: '以开发能力与质量背书切入,展示相近高端样品,不要主打低价',
  },
  growth_activewear: {
    label: '成长型运动服品牌',
    buyingBehavior: '快速上新、补单频繁、价格与交期并重,正在搭建/优化供应链',
    priceSensitivity: 'medium', qualitySensitivity: 'medium',
    developmentNeeds: '中:核心款稳定 + 适度新款开发',
    likelyDecisionMaker: 'Sourcing/Production Manager;成长期常为运营或创始人兼任',
    bestApproach: '以"低 MOQ + 快打样 + 稳定补单"切入,抓扩张期的供应链缺口',
  },
  off_price_discount: {
    label: 'Off-price / 折扣渠道品牌',
    buyingBehavior: '走量、价格驱动、机会型采购、看重成本与稳定供货,常清库存/尾货',
    priceSensitivity: 'high', qualitySensitivity: 'low',
    developmentNeeds: '低:沿用现有款、少开发',
    likelyDecisionMaker: 'Buyer / Sourcing Manager(成本导向)',
    bestApproach: '主打成本控制 + 稳定质量 + 快速补货,给有竞争力 FOB,展示现成相近款,不过度推开发',
  },
  wholesale_trade: {
    label: '批发 / 贸易品牌',
    buyingBehavior: '大单、品类广、压价、要求账期,转单灵活',
    priceSensitivity: 'high', qualitySensitivity: 'medium',
    developmentNeeds: '低-中:标准款为主',
    likelyDecisionMaker: 'Purchasing/Procurement Manager',
    bestApproach: '以价格 + 产能 + 准时交付切入,定位可靠走量供应商,注意账期/付款风险',
  },
  retail_private_label: {
    label: '零售私牌买手',
    buyingBehavior: '季节性 program、按 spec 采购、要合规与审厂、量大周期长',
    priceSensitivity: 'medium', qualitySensitivity: 'high',
    developmentNeeds: '中:按买手 spec 打样、合规文件',
    likelyDecisionMaker: 'Buyer / Merchandising Director / Sourcing Director',
    bestApproach: '以合规 + 一致性 + program 承接能力切入,准备审厂与文件,长周期培育',
  },
  ecom_micro: {
    label: '电商微品牌',
    buyingBehavior: '极小单、预算有限、决策快、常一件代发/小批量试单',
    priceSensitivity: 'high', qualitySensitivity: 'low',
    developmentNeeds: '低:现成款 + 贴牌',
    likelyDecisionMaker: '创始人本人',
    bestApproach: '低 MOQ + 现成款 + 快速试单切入;轻投入,自动化跟进,别耗费高成本资源',
  },
  distributor_importer: {
    label: '分销商 / 进口商',
    buyingBehavior: '大批量、按柜采购、多 SKU、看重进口经验与单证、价格敏感',
    priceSensitivity: 'high', qualitySensitivity: 'medium',
    developmentNeeds: '低:标准款走量',
    likelyDecisionMaker: 'Procurement / Sourcing Director;Owner',
    bestApproach: '以产能 + FOB + 出口经验切入,用海关线索佐证体量,定位长期走量供应商',
  },
  unqualified: {
    label: '不合格 / 低价值线索',
    buyingBehavior: '无明确服装采购或与我方能力不匹配',
    priceSensitivity: 'medium', qualitySensitivity: 'medium',
    developmentNeeds: '无',
    likelyDecisionMaker: '不明',
    bestApproach: '不投入资源,放弃或仅自动化保留',
  },
}

const has = (text: string, re: RegExp) => re.test(text)

export function classifyCustomerType(c: CompanyFacts): CustomerTypeProfile {
  const cats = (c.productCategories ?? []).join(' ').toLowerCase()
  const text = `${c.name ?? ''} ${c.description ?? ''} ${c.companyType ?? ''}`.toLowerCase()
  const price = (c.pricePoint ?? '').toLowerCase()
  const emp = (c.employeeRange ?? '').toLowerCase()
  const matchScore = c.productMatchScore ?? 0
  const scale = c.customerScaleScore ?? 0
  const apparelRe = /activewear|sportswear|athleisure|yoga|legging|apparel|clothing|fitness|garment|swimwear|fleece|jogger/
  const isApparel = apparelRe.test(cats) || matchScore >= 3 || apparelRe.test(text)

  let type: CustomerType
  let confidence = 0.7
  const rationale: string[] = []

  if (!isApparel && matchScore <= 2) {
    type = 'unqualified'; confidence = 0.8
    rationale.push('无明确服装品类且产品契合很低')
  } else if (has(text, /\bimporter\b|\bimport\b|distribut|wholesaler|importador/) || c.companyType === 'importer' || c.companyType === 'distributor') {
    type = 'distributor_importer'; confidence = 0.75
    rationale.push('公司类型/文案显示进口/分销特征')
    if (c.customsEvidence) { rationale.push('存在海关进口记录'); confidence = 0.85 }
  } else if (price === 'budget' && has(text, /outlet|discount|clearance|off.?price|liquidat|overstock|bargain|closeout|tj ?maxx|tjx|ross|marshalls|sierra|bealls|nordstrom rack/)) {
    type = 'off_price_discount'; confidence = 0.8
    rationale.push('低价位 + 折扣/清库存/off-price 渠道信号')
  } else if (has(text, /off.?price|tjx|ross|marshalls|sierra|bealls|closeout|overstock/)) {
    type = 'off_price_discount'; confidence = 0.7
    rationale.push('文案出现 off-price/折扣渠道关键词')
  } else if (c.companyType === 'wholesale' || has(text, /wholesale|b2b|trade supplier|bulk order/)) {
    type = 'wholesale_trade'; confidence = 0.72
    rationale.push('批发/贸易/B2B 走量信号')
  } else if (c.companyType === 'retail_chain' || has(text, /private label|own brand|store brand|retail chain|department store/)) {
    type = 'retail_private_label'; confidence = 0.72
    rationale.push('零售连锁/私牌买手信号')
  } else if ((price === 'premium' || price === 'luxury') && (c.companyType === 'dtc_brand' || c.shopifyDetected)) {
    type = 'premium_dtc'; confidence = 0.78
    rationale.push('高端价位 + DTC/Shopify')
  } else if ((emp.includes('1-10') || emp === 'self' || scale <= 3) && (c.shopifyDetected || has(text, /marketplace|amazon|etsy|tiktok shop/))) {
    type = 'ecom_micro'; confidence = 0.68
    rationale.push('规模很小 + 电商/平台渠道 → 微品牌')
  } else {
    type = 'growth_activewear'; confidence = isApparel ? 0.65 : 0.5
    rationale.push('服装 DTC、中价位、成长期 → 默认成长型运动服品牌')
  }

  if (c.pricePoint) rationale.push(`价位档:${c.pricePoint}`)
  if (c.productCategories?.length) rationale.push(`品类:${c.productCategories.slice(0, 4).join('/')}`)

  const p = TYPE_PROFILES[type]
  return {
    type, label: p.label, confidence: Math.round(confidence * 100) / 100, rationale,
    buyingBehavior: p.buyingBehavior, priceSensitivity: p.priceSensitivity, qualitySensitivity: p.qualitySensitivity,
    developmentNeeds: p.developmentNeeds, likelyDecisionMaker: p.likelyDecisionMaker, bestApproach: p.bestApproach,
  }
}
