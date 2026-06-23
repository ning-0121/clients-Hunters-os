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

  // 1) Incumbent supplier — the single biggest ODM-switching reality, was missing.
  const suppliers = c.currentSuppliers ?? []
  if (suppliers.length) {
    items.push({ risk: '现供应商粘性', severity: 'high', note: `已在用:${suppliers.slice(0, 3).join('、')} → 切换有惯性/打样成本。须用差异化(打样速度/低 MOQ/某品类专长)撬动,勿打价格战` })
  } else {
    items.push({ risk: '现供应商未知', severity: 'medium', note: '未确认在用工厂 → 查 ImportYeti 海关数据锁定现供应商与原产国,再定切入角度' })
  }

  // 2) 验厂 / 合规门槛 — a hard gate to first order, was missing.
  const blockers = c.complianceBlockers ?? []
  const highComply = c.complianceLevel === 'sedex_smeta' || c.complianceLevel === 'customer_audit' || c.complianceLevel === 'supplier_portal'
  if (blockers.length) {
    items.push({ risk: '合规/验厂阻碍', severity: 'high', note: `首单前必须解决:${blockers.join('、')} — 否则无法供货` })
  } else if (highComply) {
    items.push({ risk: '验厂门槛', severity: 'high', note: `需 ${c.complianceLevel} 级验厂 → 需用已审核合作工厂,否则进不了供应商池` })
  } else {
    items.push({ risk: '验厂门槛', severity: 'low', note: '暂未见高门槛(仍需向买手确认 BSCI/SMETA/客户审厂)' })
  }

  // 3) 价格口径风险 — explicitly flag FOB/DDP unknown (per BD feedback).
  items.push({ risk: '价格/口径风险', severity: 'medium', note: '目标采购价与 FOB/DDP 口径未证实 → 首轮必须问到真实数字,勿用系统臆测报价' })

  const payHigh = (c.paymentRiskScore ?? 0) >= 6 || type === 'distributor_importer' || type === 'wholesale_trade'
  items.push({ risk: '付款/国家风险', severity: sev(payHigh, 'high', 'low'), note: payHigh ? `${c.country ?? '该国'}·走量/贸易类 → TT 定金+尾款见提单/LC,控敞口` : `${c.country ?? '—'} · 暂无高风险信号,首单建议 TT 定金` })

  const pricePressure = HIGH_PRICE_PRESSURE.has(type)
  if (pricePressure) items.push({ risk: '压价风险', severity: 'high', note: '价格驱动型客户 → 守成本底线,用阶梯价/MOQ 换价' })

  const scaleLow = (c.customerScaleScore ?? 5) <= 3
  items.push({ risk: '客户规模风险', severity: scaleLow ? 'medium' : 'low', note: scaleLow ? '规模偏小 → 单值有限,控投入产出' : '规模可接受' })

  const contactRisk = !access.hasReachableChampionOrDM
  items.push({ risk: '可达性风险', severity: sev(contactRisk, 'high', 'low'), note: contactRisk ? `尚无可达决策人(Access ${access.score})→ 先解决找人` : '已可达决策人' })

  const complexRisk = fit.constructionComplexity === 'high'
  if (complexRisk) items.push({ risk: '工艺复杂度风险', severity: 'medium', note: `${fit.factoryRequirement} → 确认产能与验厂匹配` })

  const lowMargin = exec.marginBand === 'thin' || exec.marginBand === 'low'
  const strategicAccount = exec.rating === 'A' && (c.strategicValueScore ?? 0) >= 7 && (exec.annualPotentialUsd?.high ?? 0) >= 500_000
  const quickWin = (exec.rating === 'B' || exec.rating === 'C') && access.hasReachableChampionOrDM && fit.constructionComplexity !== 'high' && (type === 'growth_activewear' || type === 'ecom_micro' || type === 'off_price_discount')
  const lowMarginVolume = lowMargin && VOLUME_LOW_MARGIN.has(type)

  return { items, strategicAccount, quickWin, lowMarginVolume }
}
