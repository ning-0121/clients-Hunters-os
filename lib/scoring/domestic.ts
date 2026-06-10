/**
 * Domestic Chinese trading-company scoring.
 *
 * Deliberately separate from overseas brand ICP scoring. Domestic foreign-trade
 * companies (义乌/杭州/宁波/广州/深圳/上海 服装外贸公司 等) are targets in two ways:
 *   1. order cooperation / channel partnership (they place apparel orders / resell)
 *   2. software customers for ARAOS / Order Metronome / Trade OS
 *
 * The LLM rates raw signals 0-10; this module aggregates them deterministically
 * into the three potential scores + an overall grade + a recommended purpose.
 */

export type DevelopmentPurpose =
  | 'order_cooperation' | 'software_sales' | 'channel_partnership'
  | 'supplier_partnership' | 'unknown'

export interface DomesticSignals {
  apparelRelevance: number      // 0-10 — apparel / activewear relevance
  exportRelevance: number       // 0-10 — real export business
  regionRelevance: number       // 0-10 — key sourcing/trade hub
  hiringExpansionSignal: number // 0-10 — hiring 跟单/业务员, expanding
  managementPainSignal: number  // 0-10 — order-management / ERP / CRM pain
  orderCoopPotential: number    // 0-10 — likely to place / share apparel orders
  softwareSalesPotential: number// 0-10 — likely to buy trade software
  channelPartnerPotential: number// 0-10 — could become a channel/agency partner
}

export interface DomesticScores {
  orderPartnerPotential: number      // 0-10
  softwareCustomerPotential: number  // 0-10
  channelPartnershipPotential: number// 0-10
  overall: number                    // 0-100
  grade: 'A' | 'B' | 'C' | 'D'
  recommendedPurpose: DevelopmentPurpose
}

function clamp10(n: unknown): number {
  const v = typeof n === 'number' ? n : Number(n)
  if (Number.isNaN(v)) return 0
  return Math.max(0, Math.min(10, v))
}

export function computeDomesticScores(raw: DomesticSignals): DomesticScores {
  const s: DomesticSignals = {
    apparelRelevance:       clamp10(raw.apparelRelevance),
    exportRelevance:        clamp10(raw.exportRelevance),
    regionRelevance:        clamp10(raw.regionRelevance),
    hiringExpansionSignal:  clamp10(raw.hiringExpansionSignal),
    managementPainSignal:   clamp10(raw.managementPainSignal),
    orderCoopPotential:     clamp10(raw.orderCoopPotential),
    softwareSalesPotential: clamp10(raw.softwareSalesPotential),
    channelPartnerPotential:clamp10(raw.channelPartnerPotential),
  }

  // Order partner potential: apparel + export + explicit order-coop signal.
  const orderPartnerPotential = round1(
    s.apparelRelevance * 0.35 + s.exportRelevance * 0.30 + s.orderCoopPotential * 0.35,
  )

  // Software customer potential: management pain + hiring/expansion + explicit software signal.
  // Export scale lifts it slightly (more orders = more to manage).
  const softwareCustomerPotential = round1(
    s.managementPainSignal * 0.35 + s.softwareSalesPotential * 0.30 +
    s.hiringExpansionSignal * 0.20 + s.exportRelevance * 0.15,
  )

  const channelPartnershipPotential = round1(
    s.channelPartnerPotential * 0.5 + s.exportRelevance * 0.25 + s.regionRelevance * 0.25,
  )

  // Overall = best realistic use of this account (we develop it for its strongest angle),
  // with a small region bonus since hub companies are easier to reach/visit.
  const best = Math.max(orderPartnerPotential, softwareCustomerPotential, channelPartnershipPotential)
  const overall = Math.max(0, Math.min(100, best * 9 + s.regionRelevance * 1))

  const grade: DomesticScores['grade'] =
    overall >= 70 ? 'A' : overall >= 50 ? 'B' : overall >= 30 ? 'C' : 'D'

  const recommendedPurpose = pickPurpose(
    orderPartnerPotential, softwareCustomerPotential, channelPartnershipPotential,
  )

  return {
    orderPartnerPotential, softwareCustomerPotential, channelPartnershipPotential,
    overall: round1(overall), grade, recommendedPurpose,
  }
}

function pickPurpose(order: number, software: number, channel: number): DevelopmentPurpose {
  const max = Math.max(order, software, channel)
  if (max < 3) return 'unknown'
  if (max === software) return 'software_sales'
  if (max === order) return 'order_cooperation'
  return 'channel_partnership'
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}
