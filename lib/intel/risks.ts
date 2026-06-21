/**
 * Risk assessment — concrete risks driven by customer type + scores + access,
 * plus the three account-shape flags (strategic / quick-win / low-margin volume).
 */
import type { AccessResult } from '@/lib/contacts/access'
import type { CompanyFacts, CustomerType, ExecutiveDecision, ProductSupplyFit, RiskAssessment, RiskItem } from '@/lib/intel/types'

const HIGH_PRICE_PRESSURE: Set<CustomerType> = new Set(['off_price_discount', 'wholesale_trade', 'distributor_importer', 'ecom_micro'])
const VOLUME_LOW_MARGIN: Set<CustomerType> = new Set(['off_price_discount', 'wholesale_trade', 'distributor_importer'])

export function buildRiskAssessment(
  c: CompanyFacts,
  type: CustomerType,
  exec: ExecutiveDecision,
  fit: ProductSupplyFit,
  access: AccessResult,
): RiskAssessment {
  const items: RiskItem[] = []
  const sev = (b: boolean, hi: 'high' | 'medium', lo: 'medium' | 'low') => (b ? hi : lo)

  const payHigh = (c.paymentRiskScore ?? 0) >= 6 || type === 'distributor_importer' || type === 'wholesale_trade'
  items.push({ risk: '付款风险', severity: sev(payHigh, 'high', 'low'), note: payHigh ? '走量/贸易类或风险分高 → 用 TT 定金/LC,控敞口' : '暂无明显信号' })

  const pricePressure = HIGH_PRICE_PRESSURE.has(type)
  items.push({ risk: '压价风险', severity: pricePressure ? 'high' : 'medium', note: pricePressure ? '价格驱动型客户 → 守住成本底线,用阶梯价' : '中等' })

  const lowMargin = exec.marginBand === 'thin' || exec.marginBand === 'low'
  items.push({ risk: '低毛利风险', severity: lowMargin ? 'high' : 'low', note: `预期毛利档:${exec.marginBand}` })

  const unstable = type === 'off_price_discount' || type === 'ecom_micro'
  items.push({ risk: '订单不稳风险', severity: unstable ? 'medium' : 'low', note: unstable ? '机会型/小单 → 订单波动大' : '相对稳定' })

  if (type === 'off_price_discount') items.push({ risk: '清库存属性', severity: 'medium', note: '可能以尾货/清仓为主 → 重复性弱' })

  const scaleLow = (c.customerScaleScore ?? 5) <= 3
  items.push({ risk: '客户规模风险', severity: scaleLow ? 'medium' : 'low', note: scaleLow ? '规模偏小 → 单值有限' : '规模可接受' })

  const contactRisk = !access.hasReachableChampionOrDM
  items.push({ risk: '可达性风险', severity: sev(contactRisk, 'high', 'low'), note: contactRisk ? `尚无可达决策人(Access ${access.score})→ 先解决找人` : '已可达决策人' })

  const complexRisk = fit.constructionComplexity === 'high'
  items.push({ risk: '工艺复杂度风险', severity: complexRisk ? 'medium' : 'low', note: complexRisk ? `${fit.factoryRequirement} → 确认产能匹配` : '工艺难度可控' })

  const strategicAccount = exec.rating === 'A' && (c.strategicValueScore ?? 0) >= 7 && (exec.annualPotentialUsd?.high ?? 0) >= 500_000
  const quickWin = (exec.rating === 'B' || exec.rating === 'C') && access.hasReachableChampionOrDM && fit.constructionComplexity !== 'high' && (type === 'growth_activewear' || type === 'ecom_micro' || type === 'off_price_discount')
  const lowMarginVolume = lowMargin && VOLUME_LOW_MARGIN.has(type)

  return { items, strategicAccount, quickWin, lowMarginVolume }
}
