/**
 * Grounded credit / payment-risk assessment.
 *
 * NOT an LLM guess and NOT a paid credit bureau. A transparent, rule-based score
 * built from REAL signals we already collect — most importantly customs shipment
 * volume (ImportYeti = real, ongoing trade = a genuine solvency/scale signal),
 * plus company size, age, funding, country and revenue. Every factor is shown,
 * and `confidence` reflects how much real data backed the score, so it never
 * pretends to be a credit guarantee. Big deals still warrant Sinosure / manual check.
 */

export interface CreditSignals {
  customsShipments?: number | null
  hasCustomsHistory?: boolean
  employeeRange?: string | null
  fundingDetected?: boolean
  foundedYear?: number | null
  country?: string | null
  estRevenue?: string | null
  pricePoint?: string | null
}

export type CreditBand = '低风险' | '中等' | '偏高' | '数据不足'

export interface CreditFactor { label: string; effect: 'good' | 'bad' | 'neutral'; note: string }

export interface CreditAssessment {
  riskScore: number        // 0-10, higher = riskier
  band: CreditBand
  confidence: number       // 0-1 (how much real data backed it)
  factors: CreditFactor[]
  recommendation: string
}

const STABLE_COUNTRIES = ['United States', 'United Kingdom', 'Germany', 'France', 'Italy', 'Canada', 'Australia', 'Netherlands', 'Sweden', 'Spain', 'Japan', 'Switzerland', 'Belgium', 'Denmark', 'Norway', 'Austria', 'New Zealand', 'Ireland', 'Finland']
const HIGHER_RISK_COUNTRIES = ['Nigeria', 'Pakistan', 'Venezuela', 'Bangladesh', 'Egypt', 'Iran', 'Lebanon', 'Argentina']

/** Parse "3,665 shipments" → 3665. */
export function parseShipments(text?: string | null): number | null {
  if (!text) return null
  const m = text.match(/([\d,]+)\s*shipments?/i)
  if (!m) return null
  const n = parseInt(m[1].replace(/,/g, ''), 10)
  return Number.isFinite(n) ? n : null
}

export function assessCredit(s: CreditSignals, currentYear = new Date().getFullYear()): CreditAssessment {
  let risk = 5            // neutral baseline
  let evidence = 0        // distinct real signals → drives confidence
  const factors: CreditFactor[] = []

  // Customs shipment volume — strongest real signal.
  const ship = s.customsShipments
  if (typeof ship === 'number' && ship > 0) {
    evidence++
    if (ship >= 1000) { risk -= 2.5; factors.push({ label: '海关走货量', effect: 'good', note: `~${ship} 票，进口活跃、实力强` }) }
    else if (ship >= 100) { risk -= 1.5; factors.push({ label: '海关走货量', effect: 'good', note: `~${ship} 票，有稳定进口` }) }
    else { risk -= 0.5; factors.push({ label: '海关走货量', effect: 'neutral', note: `~${ship} 票，进口量有限` }) }
  } else if (s.hasCustomsHistory) {
    evidence++; risk -= 0.5
    factors.push({ label: '海关记录', effect: 'good', note: '有进口记录（票数未知）' })
  } else {
    factors.push({ label: '海关记录', effect: 'neutral', note: '未查到进口记录（建议查 ImportYeti）' })
  }

  // Company size.
  const er = s.employeeRange ?? ''
  if (/500\+|201-500/.test(er)) { evidence++; risk -= 1.5; factors.push({ label: '公司规模', effect: 'good', note: `${er} 人，规模较大` }) }
  else if (/51-200/.test(er)) { evidence++; risk -= 0.8; factors.push({ label: '公司规模', effect: 'good', note: `${er} 人` }) }
  else if (/1-10/.test(er)) { evidence++; risk += 1; factors.push({ label: '公司规模', effect: 'bad', note: `${er} 人，小微，付款能力不确定` }) }

  // Funding.
  if (s.fundingDetected) { evidence++; risk -= 1; factors.push({ label: '融资', effect: 'good', note: '检测到融资，资金面较好' }) }

  // Years in business.
  if (s.foundedYear && s.foundedYear > 1900) {
    evidence++
    const age = currentYear - s.foundedYear
    if (age >= 10) { risk -= 1.5; factors.push({ label: '经营年限', effect: 'good', note: `约 ${age} 年，经营稳定` }) }
    else if (age >= 5) { risk -= 0.5; factors.push({ label: '经营年限', effect: 'neutral', note: `约 ${age} 年` }) }
    else if (age < 2) { risk += 1; factors.push({ label: '经营年限', effect: 'bad', note: `成立 ${age} 年，过新` }) }
  }

  // Country.
  if (s.country) {
    evidence++
    if (STABLE_COUNTRIES.includes(s.country)) { risk -= 0.5; factors.push({ label: '国家风险', effect: 'good', note: `${s.country}，低国家风险` }) }
    else if (HIGHER_RISK_COUNTRIES.includes(s.country)) { risk += 1.5; factors.push({ label: '国家风险', effect: 'bad', note: `${s.country}，国家/收汇风险偏高` }) }
    else { factors.push({ label: '国家风险', effect: 'neutral', note: s.country }) }
  }

  // Revenue hint.
  if (s.estRevenue) {
    if (/B|billion|>\s*\$?\s*\d{3}M|\$\s*\d{3,}M/i.test(s.estRevenue)) { evidence++; risk -= 1; factors.push({ label: '营收', effect: 'good', note: s.estRevenue }) }
  }

  // Price-only buyers carry thinner margins → marginally riskier.
  if (s.pricePoint === 'budget') { risk += 0.5; factors.push({ label: '价位', effect: 'bad', note: '低价导向，利润/账期压力' }) }

  risk = Math.max(0, Math.min(10, Math.round(risk * 10) / 10))
  const confidence = Math.min(1, evidence / 4)

  let band: CreditBand
  if (confidence < 0.3) band = '数据不足'
  else if (risk <= 3.5) band = '低风险'
  else if (risk <= 6) band = '中等'
  else band = '偏高'

  const recommendation =
    band === '数据不足' ? '数据不足以评估，建议先查海关数据/补全信息，大单走前 T/T 或人工核实（中信保）。'
    : band === '低风险' ? '可考虑正常账期；大单仍建议首单部分预付。'
    : band === '中等' ? '建议首单 30% 定金 / 余款见提单，建立信任后再放宽。'
    : '建议前 T/T 全款或小额试单；大单务必投保（中信保）或人工尽调。'

  return { riskScore: risk, band, confidence: Math.round(confidence * 100) / 100, factors, recommendation }
}
