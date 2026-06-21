/**
 * validate:intel — pure unit tests for the Customer Intelligence Brief inference.
 * No DB / no LLM. Covers the LEG3ND archetype (off-price) + premium/growth/unqualified
 * and the "never dead-end the decision chain" rule.
 */
import { buildBrief } from '@/lib/intel/brief'
import { computeAccess, type AccessContact } from '@/lib/contacts/access'
import type { BriefContact, BriefInputs, CompanyFacts } from '@/lib/intel/types'

let pass = 0, fail = 0
const ok = (name: string, cond: boolean) => { if (cond) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) } else { fail++; console.log(`  \x1b[31m✗ ${name}\x1b[0m`) } }

function mkInputs(company: Partial<CompanyFacts>, contacts: BriefContact[] = []): BriefInputs {
  const ac: AccessContact[] = contacts.map((c) => ({
    email: c.email, email_verified: c.emailVerified, email_source: c.emailSource, email_confidence: c.emailConfidence,
    role_type: c.roleType, decision_level: c.decisionLevel, status: c.status,
  }))
  return {
    company: { name: 'Test Co', productCategories: [], techStack: [], productMatch: [], ...company },
    contacts,
    access: computeAccess(ac),
    quoteCategories: [],
    openDeals: 0,
  }
}

// ── 1. LEG3ND archetype — off-price / discount, no contacts ────────────────────
console.log('#1 Off-price/discount archetype (LEG3ND-like)')
const offPrice = buildBrief(mkInputs({
  name: 'LEG3ND', productCategories: ['joggers', 'tracksuits', 'fleece', 'activewear'],
  pricePoint: 'budget', description: 'discount outlet clearance activewear for off-price channels',
  productMatchScore: 6, customerScaleScore: 6, customerTier: 'B',
  productMatch: [{ category: 'Joggers', level: 'High', suggested_qimo_product: 'Fleece jogger set' }],
}))
ok('类型 = off_price_discount', offPrice.customerType.type === 'off_price_discount')
ok('采购模型 ∈ off-price 家族', ['off_price_channel', 'inventory_clearance'].includes(offPrice.purchasingModel.model))
ok('竞争轴含价格', offPrice.winningStrategy.competeOn.includes('price'))
ok('不提供打样开发(用现成款)', offPrice.winningStrategy.offerSampleDevelopment === false)
ok('定位 = 备供', offPrice.winningStrategy.positioning === 'backup_supplier')
ok('主打产品来自切入品', !!offPrice.winningStrategy.leadProduct && offPrice.winningStrategy.leadProduct !== '其核心在售款')
ok('FOB 区间含 $', offPrice.productFit.targetFobRange.includes('$'))
ok('go(值得开发)', offPrice.executive.decision === 'go')
ok('无联系人 ⇒ Action=hunt(找人)', offPrice.resource.action === 'hunt')
ok('决策链不死板:决策人=inferred(非"未找到")', offPrice.decisionChain.decisionMaker.status === 'inferred')
ok('给出"下一个找谁"', offPrice.decisionChain.recommendedNextContact.length > 0)
ok('守门人 inferred = 客服(兜底)', offPrice.decisionChain.gatekeeper.title.includes('客服'))
ok('下一步动作 ≥ 5', offPrice.nextActions.length >= 5)
ok('低毛利走量标记', offPrice.risk.lowMarginVolume === true)
ok('可达性风险=high(无可达人)', offPrice.risk.items.some((r) => r.risk === '可达性风险' && r.severity === 'high'))

// ── 2. Premium DTC, reachable decision-maker ───────────────────────────────────
console.log('\n#2 Premium DTC + reachable Apollo DM')
const premium = buildBrief(mkInputs({
  name: 'Lux Active', productCategories: ['activewear', 'seamless', 'yoga'], pricePoint: 'premium',
  companyType: 'dtc_brand', shopifyDetected: true, productMatchScore: 8, customerScaleScore: 8,
  strategicValueScore: 7, customerTier: 'A',
  productMatch: [{ category: 'Seamless leggings', level: 'High', suggested_qimo_product: 'Seamless legging' }],
}, [{ fullName: 'Jane Doe', title: 'Director of Sourcing', roleType: 'sourcing', decisionLevel: 'decision_maker', email: 'jane@lux.com', emailSource: 'apollo', emailVerified: false }]))
ok('类型 = premium_dtc', premium.customerType.type === 'premium_dtc')
ok('已可达 ⇒ Action=strike', premium.resource.action === 'strike')
ok('go + 高赢率', premium.executive.decision === 'go' && premium.executive.winProbability >= 50)
ok('竞争轴含开发或质量', premium.winningStrategy.competeOn.includes('development') || premium.winningStrategy.competeOn.includes('quality'))
ok('提供打样开发', premium.winningStrategy.offerSampleDevelopment === true)
ok('决策人 = found', premium.decisionChain.decisionMaker.status === 'found')
ok('建 Deal 动作', premium.nextActions.some((a) => a.kind === 'deal' && a.task.includes('Deal')))
ok('战略账户标记', premium.risk.strategicAccount === true)

// ── 3. Unqualified ─────────────────────────────────────────────────────────────
console.log('\n#3 Unqualified')
const unq = buildBrief(mkInputs({ name: 'Random Co', productCategories: ['electronics'], productMatchScore: 1 }))
ok('类型 = unqualified', unq.customerType.type === 'unqualified')
ok('no_go', unq.executive.decision === 'no_go')
ok('Action = abandon', unq.resource.action === 'abandon')
ok('下一步 = 放弃', unq.nextActions.length === 1 && unq.nextActions[0].task.includes('放弃'))

// ── 4. Growth activewear default ───────────────────────────────────────────────
console.log('\n#4 Growth activewear (default)')
const growth = buildBrief(mkInputs({
  name: 'Move Brand', productCategories: ['activewear', 'leggings'], pricePoint: 'mid',
  companyType: 'dtc_brand', productMatchScore: 6, customerScaleScore: 5, customerTier: 'B',
}))
ok('类型 = growth_activewear', growth.customerType.type === 'growth_activewear')
ok('采购模型 = oem_direct', growth.purchasingModel.model === 'oem_direct')
ok('headline 30 秒可读(非空)', growth.executive.headline.length > 10)

console.log(`\n结果：${pass} 通过 / ${fail} 失败`)
process.exit(fail > 0 ? 1 : 0)
