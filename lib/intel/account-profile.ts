/**
 * Account profile — surfaces the operational facts a BD needs but the brief was
 * hiding: location, sales channel, 验厂/合规 bar, incumbent suppliers, customs
 * status, and a rule-based credit read. Everything here is EVIDENCE from the
 * record; anything we don't have a source for is null → shown as UNKNOWN, never
 * guessed (HQ street address and China office have no source yet).
 */
import type { CompanyFacts, AccountProfile } from '@/lib/intel/types'
import { assessCredit, parseShipments } from '@/lib/credit/assess'

const CHANNEL: Record<string, string> = {
  dtc_brand: 'DTC 自营品牌（官网/社媒直销）',
  activewear_brand: '运动服品牌（DTC，可能含批发）',
  wholesaler: '批发商 / 贸易',
  retailer: '零售商（多品牌）',
  marketplace: '电商平台卖家',
}

const COMPLY_ZH: Record<string, string> = {
  none: '无需验厂', basic_docs: '基础资质文件', bsci_wrap: 'BSCI / WRAP',
  sedex_smeta: 'Sedex / SMETA', oeko_grs: 'OEKO-TEX / GRS',
  customer_audit: '客户自有验厂', supplier_portal: '供应商门户注册',
}

export function buildAccountProfile(c: CompanyFacts): AccountProfile {
  const location = [c.city, c.region, c.country].filter(Boolean).join('、') || '未知'

  const credit = assessCredit({
    customsShipments: c.customsShipments ?? parseShipments(c.customsText ?? ''),
    hasCustomsHistory: !!c.customsEvidence || (c.customsShipments ?? 0) > 0 || (c.currentSuppliers?.length ?? 0) > 0,
    employeeRange: c.employeeRange ?? null,
    fundingDetected: !!c.fundingDetected,
    foundedYear: c.foundedYear ?? null,
    country: c.country ?? null,
    estRevenue: c.estimatedAnnualRevenue ?? null,
    pricePoint: c.pricePoint ?? null,
  })

  const customsStatus = c.customsShipments != null && c.customsShipments > 0
    ? `有进口记录:${c.customsShipments} 票（ImportYeti 海关数据）`
    : c.customsEvidence ? '有进口记录（见原始证据）' : '无进口记录 — 待 ImportYeti 拉取'

  return {
    location,
    hqAddress: c.hqAddress ?? null,   // real address (ImportYeti) or UNKNOWN — never invented
    chinaOffice: null,                // needs discovery pipeline — UNKNOWN, not invented
    salesChannel: (c.companyType && CHANNEL[c.companyType]) || c.companyType || '未知（需确认 DTC/批发/零售）',
    complianceLabel: c.complianceLevel ? (COMPLY_ZH[c.complianceLevel] ?? c.complianceLevel) : '未知（需确认 BSCI/SMETA/客户审厂）',
    complianceRequirements: c.complianceRequirements ?? [],
    complianceBlockers: c.complianceBlockers ?? [],
    currentSuppliers: c.currentSuppliers ?? [],
    customsStatus,
    credit: { band: credit.band, riskScore: credit.riskScore, confidence: credit.confidence, recommendation: credit.recommendation },
  }
}
