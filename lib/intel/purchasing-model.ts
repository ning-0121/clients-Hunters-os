/**
 * Purchasing-model inference — HOW the account buys. Driven mostly by customer
 * type, refined by channel/price/SKU/customs evidence.
 */
import type { BriefInputs, CustomerType, PurchasingModel, PurchasingModelInference } from '@/lib/intel/types'

const LABELS: Record<PurchasingModel, string> = {
  oem_direct: 'OEM 直接向工厂下单',
  trading_company: '经贸易公司采购',
  importer: '进口商采购',
  private_label: '私牌(贴牌)采购',
  off_price_channel: 'Off-price / 折扣渠道采购',
  inventory_clearance: '清库存 / 尾货采购',
  small_batch_dtc: '小批量 DTC 采购',
  seasonal_program: '季节性 program 采购',
}

const BY_TYPE: Record<CustomerType, PurchasingModel> = {
  premium_dtc: 'oem_direct',
  growth_activewear: 'oem_direct',
  off_price_discount: 'off_price_channel',
  wholesale_trade: 'trading_company',
  retail_private_label: 'seasonal_program',
  ecom_micro: 'small_batch_dtc',
  distributor_importer: 'importer',
  unqualified: 'small_batch_dtc',
}

export function inferPurchasingModel(inputs: BriefInputs, type: CustomerType): PurchasingModelInference {
  const c = inputs.company
  const text = `${c.name ?? ''} ${c.description ?? ''}`.toLowerCase()
  const evidence: string[] = []
  let model = BY_TYPE[type]
  let confidence = 0.62

  // Refinements from concrete evidence.
  if (/clearance|liquidat|overstock|closeout|尾货|清仓/.test(text)) { model = 'inventory_clearance'; confidence = 0.75; evidence.push('文案含清库存/尾货信号') }
  else if (c.customsEvidence && (type === 'distributor_importer' || type === 'wholesale_trade')) { model = 'importer'; confidence = 0.8; evidence.push('海关进口记录支持进口商模型') }
  else if (type === 'premium_dtc' && /custom|bespoke|developed in-house|our own design/.test(text)) { model = 'private_label'; confidence = 0.72; evidence.push('高端 DTC + 自有设计 → 私牌直采') }

  // Generic evidence.
  if (c.shopifyDetected) evidence.push('Shopify DTC 渠道')
  if (c.pricePoint) evidence.push(`价位:${c.pricePoint}`)
  const skuBreadth = (c.productCategories ?? []).length
  if (skuBreadth >= 5) evidence.push(`SKU 品类多(${skuBreadth})→ 偏走量/program`)
  if (c.customsEvidence) evidence.push('有进口/海关证据')
  if (!evidence.length) evidence.push(`由客户类型(${type})推断`)

  return { model, label: LABELS[model], confidence: Math.round(confidence * 100) / 100, evidence }
}
