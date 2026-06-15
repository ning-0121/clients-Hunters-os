/**
 * Unit tests for Customer Tiering & Intelligence Report logic.
 *
 *   npx tsx scripts/test-tiering-reports.ts
 *   (or: npm run test:tiering)
 *
 * Pure logic only — no DB or LLM. Covers:
 *   1. Tier classification (business feasibility, not generic ICP)
 *   2. Factory-type derivation
 *   3. Report-depth logic per tier
 *   4. Report schema validation (valid + invalid + missing-data cases)
 *   5. No hallucinated required fields: unknown facts may be null and still validate
 */
import {
  classifyTier, deriveFactoryType, reportDepthForTier,
  type TierDimensions,
} from '@/lib/tiering/tiering'
import { validateReport, type CustomerReport } from '@/lib/reports/report-schema'
import { validateDomesticReport } from '@/lib/reports/domestic-report-schema'
import { computeDomesticScores, type DomesticSignals } from '@/lib/scoring/domestic'
import { matchFactory, requiredCertsFor, type FactoryLite } from '@/lib/factory/matcher'
import { assessCredit, parseShipments } from '@/lib/credit/assess'

let passed = 0
let failed = 0

function assert(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; console.error(`  ✗ ${name}`) }
}
function eq<T>(name: string, actual: T, expected: T) {
  assert(`${name} (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`, actual === expected)
}

const base: TierDimensions = {
  customerScaleScore: 5, productMatchScore: 6, conversionFeasibilityScore: 5,
  strategicValueScore: 5, paymentRiskScore: 3, complianceLevel: 'basic_docs',
}

// ── 1. Tier classification ────────────────────────────────────────────────
console.log('\n[1] Tier classification')
eq('big + strategic = A',
  classifyTier({ ...base, customerScaleScore: 9, strategicValueScore: 8 }), 'A')
eq('huge brand behind SMETA wall = A (even low conversion)',
  classifyTier({ ...base, customerScaleScore: 9, conversionFeasibilityScore: 2, complianceLevel: 'supplier_portal' }), 'A')
eq('winnable mid-market = B',
  classifyTier({ ...base, customerScaleScore: 5, productMatchScore: 7, conversionFeasibilityScore: 7 }), 'B')
eq('small but workable = C',
  classifyTier({ ...base, customerScaleScore: 2, productMatchScore: 5, conversionFeasibilityScore: 4, strategicValueScore: 2 }), 'C')
eq('no product match = D',
  classifyTier({ ...base, productMatchScore: 1 }), 'D')
eq('unclear low-value buyer = D',
  classifyTier({ ...base, customerScaleScore: 2, productMatchScore: 4, conversionFeasibilityScore: 2, strategicValueScore: 2 }), 'D')
eq('high risk, not strategic = D',
  classifyTier({ ...base, paymentRiskScore: 9, strategicValueScore: 4, customerScaleScore: 6 }), 'D')
assert('tier is independent of generic ICP grade (deterministic on dims)',
  classifyTier({ ...base, customerScaleScore: 9, strategicValueScore: 8 }) === 'A' &&
  classifyTier({ ...base, customerScaleScore: 9, strategicValueScore: 8 }) === 'A')

// ── 2. Factory-type derivation ────────────────────────────────────────────
console.log('\n[2] Factory-type derivation')
eq('none → current', deriveFactoryType('none'), 'current')
eq('bsci_wrap → current_after_renewal', deriveFactoryType('bsci_wrap'), 'current_after_renewal')
eq('sedex_smeta → partner_smeta', deriveFactoryType('sedex_smeta'), 'partner_smeta')
eq('supplier_portal → partner_smeta', deriveFactoryType('supplier_portal'), 'partner_smeta')
eq('oeko_grs → partner_or_current', deriveFactoryType('oeko_grs'), 'partner_or_current')

// ── 3. Report-depth logic ─────────────────────────────────────────────────
console.log('\n[3] Report depth per tier')
eq('A → deep', reportDepthForTier('A'), 'deep')
eq('B → standard', reportDepthForTier('B'), 'standard')
eq('C → short', reportDepthForTier('C'), 'short')
eq('D → none', reportDepthForTier('D'), 'none')

// ── 4 & 5. Report schema validation ───────────────────────────────────────
console.log('\n[4] Report schema validation')

const validReport: CustomerReport = {
  executive_summary: {
    worth_developing: 'Yes — mid-size EU activewear DTC with real seamless demand.',
    tier: 'B', horizon: 'short_term',
    best_product_angle: 'Seamless leggings + sports bras',
    biggest_blocker: 'OEKO-TEX preferred', next_step: 'Email Head of Sourcing',
  },
  company_profile: {
    name: 'Acme Active', country: 'Italy', headquarters: null, founded_year: null,
    leadership: null, store_count: null, website: 'https://acme.example',
    ecommerce_channels: ['Shopify'], market_coverage: 'EU', brand_positioning: 'premium',
  },
  business_model: { classification: ['dtc_brand'], reasoning: 'Sells direct via Shopify.' },
  product_lines: [{ category: 'Leggings', confidence: 'Confirmed' }],
  product_match: [{
    category: 'Seamless leggings', match_level: 'High',
    suggested_qimo_product: 'Seamless high-waist legging', why_it_matches: 'core strength',
    risk_difficulty: null, recommended_entry_sku: null,
  }],
  compliance_requirements: {
    items: [{ requirement: 'OEKO-TEX', status: 'Preferred', note: null }],
    current_factory_can_support: 'Yes after BSCI/WRAP renewal',
    partner_factory_needed: false, bsci_wrap_renewal_enough: 'Likely', smeta_partner_needed: false,
  },
  supplier_entry_path: {
    application_url: null, has_portal: false, required_documents: [],
    application_sequence: [], follow_up_method: null, manual_strategy: 'Email sourcing contact',
  },
  contact_strategy: {
    target_titles: ['Head of Sourcing'],
    linkedin_search_queries: ['Acme Active sourcing manager'], notes: null,
  },
  outreach_angles: [{ angle: 'Seamless capacity', pitch: 'We specialize in seamless.' }],
  risk_assessment: [{ risk: 'Existing supplier lock-in', severity: 'medium', note: null }],
  recommended_actions: [{ action: 'Send intro email', priority: 'now' }],
  draft_messages: {
    first_outreach_email: { subject: 'Seamless capacity for Acme', body: 'Hi...' },
    linkedin_message: 'Hi, QIMO makes seamless activewear...',
    follow_up_email: { subject: 'Following up', body: 'Just checking in...' },
    supplier_portal_intro: 'QIMO is an activewear OEM/ODM...',
  },
  source_urls: [{ url: 'https://acme.example', used_for: 'company profile' }],
  confidence_score: 0.7,
}

assert('full valid report passes', validateReport(validReport).ok)

// Missing-data case: unknown facts as null must still validate (no forced hallucination)
const sparseReport = JSON.parse(JSON.stringify(validReport)) as CustomerReport
sparseReport.company_profile.country = null
sparseReport.company_profile.store_count = null
sparseReport.company_profile.leadership = null
sparseReport.company_profile.founded_year = null
sparseReport.compliance_requirements.items = [
  { requirement: 'SMETA', status: 'Unknown / needs verification', note: 'not found on site' },
]
assert('sparse report (null facts, unknown compliance) still validates', validateReport(sparseReport).ok)

// Invalid: missing required executive_summary field
const broken = JSON.parse(JSON.stringify(validReport)) as Record<string, unknown>
delete (broken.executive_summary as Record<string, unknown>).next_step
assert('report missing required field fails', !validateReport(broken).ok)

// Invalid: bad enum value for tier
const badTier = JSON.parse(JSON.stringify(validReport)) as Record<string, unknown>
;(badTier.executive_summary as Record<string, unknown>).tier = 'Z'
assert('report with invalid tier enum fails', !validateReport(badTier).ok)

// Invalid: confidence out of range
const badConf = JSON.parse(JSON.stringify(validReport)) as Record<string, unknown>
badConf.confidence_score = 5
assert('report with out-of-range confidence fails', !validateReport(badConf).ok)

// ── 5. Domestic scoring (separate from overseas ICP) ──────────────────────
console.log('\n[5] Domestic trading-company scoring')
const domBase: DomesticSignals = {
  apparelRelevance: 5, exportRelevance: 5, regionRelevance: 5, hiringExpansionSignal: 5,
  managementPainSignal: 5, orderCoopPotential: 5, softwareSalesPotential: 5, channelPartnerPotential: 5,
}
const orderHeavy = computeDomesticScores({ ...domBase, apparelRelevance: 9, exportRelevance: 9, orderCoopPotential: 9, softwareSalesPotential: 2, channelPartnerPotential: 2 })
eq('order-heavy → order_cooperation', orderHeavy.recommendedPurpose, 'order_cooperation')
assert('order-heavy has high orderPartnerPotential', orderHeavy.orderPartnerPotential >= 8)

const softwareHeavy = computeDomesticScores({ ...domBase, managementPainSignal: 9, softwareSalesPotential: 9, hiringExpansionSignal: 8, orderCoopPotential: 2, channelPartnerPotential: 2 })
eq('software-heavy → software_sales', softwareHeavy.recommendedPurpose, 'software_sales')

const channelHeavy = computeDomesticScores({ ...domBase, channelPartnerPotential: 9, exportRelevance: 8, regionRelevance: 8, orderCoopPotential: 3, softwareSalesPotential: 3, apparelRelevance: 3, managementPainSignal: 2, hiringExpansionSignal: 2 })
eq('channel-heavy → channel_partnership', channelHeavy.recommendedPurpose, 'channel_partnership')

const allLow = computeDomesticScores({ apparelRelevance: 1, exportRelevance: 1, regionRelevance: 1, hiringExpansionSignal: 1, managementPainSignal: 1, orderCoopPotential: 1, softwareSalesPotential: 1, channelPartnerPotential: 1 })
eq('all-low domestic → D', allLow.grade, 'D')
eq('all-low domestic → unknown purpose', allLow.recommendedPurpose, 'unknown')

// ── 6. Factory matcher (own expired BSCI/WRAP must NOT serve strict buyers) ─
console.log('\n[6] Factory matcher')
const ownExpired: FactoryLite = {
  id: 'own', name: 'QIMO own', factory_type: 'own_factory',
  main_categories: ['activewear', 'seamless', 'leggings', 'sports_bra', 'yoga'],
  certifications: [
    { certification_type: 'BSCI', status: 'expired' },
    { certification_type: 'WRAP', status: 'expired' },
    { certification_type: 'OEKO', status: 'valid' },
  ],
}
const partnerSmeta: FactoryLite = {
  id: 'partner', name: 'Partner A', factory_type: 'partner_factory',
  main_categories: ['activewear', 'seamless', 'leggings'],
  certifications: [
    { certification_type: 'SMETA', status: 'valid' },
    { certification_type: 'BSCI', status: 'valid' },
    { certification_type: 'Sedex', status: 'valid' },
  ],
}
const pool = [ownExpired, partnerSmeta]

const noAudit = matchFactory({ complianceLevel: 'none', categories: ['leggings'] }, pool)
eq('no-audit customer → current own factory', noAudit.decision, 'current')
eq('no-audit picks own factory', noAudit.factory_id, 'own')

const smetaCust = matchFactory({ complianceLevel: 'sedex_smeta', categories: ['seamless'] }, pool)
eq('SMETA customer → partner factory (NOT expired own)', smetaCust.decision, 'partner')
eq('SMETA customer routed to partner', smetaCust.factory_id, 'partner')
assert('SMETA customer surfaces own-factory compliance gap', smetaCust.compliance_gap.length > 0)

const bsciCust = matchFactory({ complianceLevel: 'bsci_wrap', categories: ['leggings'] }, pool)
eq('BSCI customer (own expired) → partner, not own', bsciCust.decision, 'partner')

const noPartnerPool = [ownExpired]
const smetaNoPartner = matchFactory({ complianceLevel: 'sedex_smeta', categories: ['seamless'] }, noPartnerPool)
eq('SMETA + only expired own factory → not_ready', smetaNoPartner.decision, 'not_ready')

assert('requiredCertsFor(sedex_smeta) includes SMETA', requiredCertsFor('sedex_smeta').includes('SMETA'))
eq('requiredCertsFor(none) empty', requiredCertsFor('none').length, 0)

// ── 7. Domestic report schema ─────────────────────────────────────────────
console.log('\n[7] Domestic report schema validation')
const validDomestic = {
  公司基本信息: { 名称: '义乌某外贸', 地区: '义乌', 成立年份: null, 规模: null, 网站: null, 简介: null },
  主营品类: ['运动服', 'leggings'],
  出口市场: { 主要市场: ['欧洲', '美国'], 说明: null },
  业务模式: '贸易商，从工厂采购出口',
  订单合作可能性: { 评分: 7, 说明: '有稳定订单' },
  软件系统需求可能性: { 评分: 8, 说明: '跟单混乱' },
  招聘扩张信号: ['招聘外贸业务员'],
  管理痛点推断: ['Excel管理订单'],
  推荐合作模式: '软件销售为主，订单合作为辅',
  推荐第一轮沟通话术: '您好，我们…',
  电话微信开场白: '王总您好',
  下一步动作: ['加微信', '发资料'],
  draft_messages: {
    wechat_message: '王总您好…',
    phone_script: '您好，请问…',
    formal_email: { subject: '合作', body: '尊敬的…' },
    software_demo_invitation: '邀请您体验…',
    order_cooperation_intro: '我们工厂…',
  },
  source_urls: [{ url: 'https://x.cn', used_for: '公司信息' }],
  confidence_score: 0.6,
}
assert('valid domestic report passes', validateDomesticReport(validDomestic).ok)
const brokenDomestic = JSON.parse(JSON.stringify(validDomestic))
delete brokenDomestic.draft_messages.wechat_message
assert('domestic report missing draft field fails', !validateDomesticReport(brokenDomestic).ok)

// ── 8. Credit assessment ───────────────────────────────────────────────────
console.log('\n[8] Credit assessment')
eq('parseShipments "3,665 shipments"', parseShipments('imports with 3,665 shipments'), 3665)
eq('parseShipments none', parseShipments('no data'), null)
const strong = assessCredit({ customsShipments: 4000, employeeRange: '201-500', foundedYear: 2012, country: 'United States' }, 2026)
eq('established importer → 低风险', strong.band, '低风险')
assert('established importer risk low', strong.riskScore <= 3.5)
const sparse = assessCredit({ country: 'United States' }, 2026)
eq('almost no data → 数据不足', sparse.band, '数据不足')
const risky = assessCredit({ employeeRange: '1-10', foundedYear: 2025, country: 'Nigeria', pricePoint: 'budget' }, 2026)
eq('tiny+new+high-risk-country → 偏高', risky.band, '偏高')
assert('credit confidence rises with evidence', strong.confidence > sparse.confidence)

// ── Summary ────────────────────────────────────────────────────────────────
console.log(`\n${failed === 0 ? '✅' : '❌'} ${passed} passed, ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)
