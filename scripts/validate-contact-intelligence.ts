/**
 * Contact Intelligence Engine — pure unit tests (no DB / no network).
 *   npx tsx scripts/validate-contact-intelligence.ts
 *
 * Covers: role priority (buying influence), Apollo priority, decision-level &
 * priority derivation, X-Ray title parsing, name splitting, and the Access Score
 * ladder + coverage + the North Star boolean (verified champion / decision-maker).
 */
import { roleRank, classifyRole } from '@/lib/contacts/roles'
import { apolloPriority, apolloRoleType, type ApolloContact } from '@/lib/enrichment/apollo'
import { decisionLevelFor, contactPriorityFor } from '@/lib/enrichment/contact-discovery'
import { parseLinkedInTitle } from '@/lib/enrichment/xray'
import { toPersonCandidate } from '@/lib/enrichment/contact-types'
import { computeAccess, type AccessContact } from '@/lib/contacts/access'
import { computeCredibility } from '@/lib/contacts/credibility'
import { isHuntDue, huntCadenceMs, huntValue, companyHuntDue, stampHunt, lastHuntAt } from '@/lib/contacts/hunt-cadence'
import { pickMailDomain, registrableDomain, stripStorefront } from '@/lib/enrichment/mail-domain'

let pass = 0, fail = 0
const ok = (n: string, c: boolean) => { if (c) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${n}`) } else { fail++; console.error(`  \x1b[31m✗\x1b[0m ${n}`) } }

const apollo = (title: string): ApolloContact => ({ firstName: 'A', lastName: 'B', fullName: 'A B', title })
const verified = (x: Partial<AccessContact>): AccessContact => ({ email: 'a@x.com', email_verified: true, ...x })
// Trusted = people-DB source (Apollo), NOT SMTP-verified — the catch-all case.
const trusted = (x: Partial<AccessContact>): AccessContact => ({ email: 'a@oneractive.com', email_source: 'apollo', email_verified: false, ...x })

console.log('角色优先级 = 采购影响力(Sourcing/Production > Founder)')
ok('roleRank(sourcing) > roleRank(founder)', roleRank('sourcing') > roleRank('founder'))
ok('roleRank(production) > roleRank(founder)', roleRank('production') > roleRank('founder'))
ok('roleRank(product) > roleRank(founder)', roleRank('product') > roleRank('founder'))
ok("classifyRole('VP Sourcing')=sourcing", classifyRole('VP Sourcing') === 'sourcing')
ok("classifyRole('Director of Production')=production", classifyRole('Director of Production') === 'production')

console.log('\nApollo 优先级(采购 > 创始人)')
ok('apolloPriority(Director of Sourcing)=9', apolloPriority(apollo('Director of Sourcing')) === 9)
ok('apolloPriority(Sourcing Manager)=8', apolloPriority(apollo('Sourcing Manager')) === 8)
ok('apolloPriority(CEO)=5', apolloPriority(apollo('CEO')) === 5)
ok('Sourcing 排在 Founder 之上', apolloPriority(apollo('Head of Sourcing')) > apolloPriority(apollo('Founder')))
ok("apolloRoleType('Merchandising Manager')=product", apolloRoleType('Merchandising Manager') === 'product')

console.log('\n决策层级 / 联系优先级 推导')
ok("decisionLevelFor('VP Sourcing','sourcing')=decision_maker", decisionLevelFor('VP Sourcing', 'sourcing') === 'decision_maker')
ok("decisionLevelFor('Sourcing Coordinator','sourcing')=influencer", decisionLevelFor('Sourcing Coordinator', 'sourcing') === 'influencer')
ok("decisionLevelFor('Team (GitHub)','other')=unknown", decisionLevelFor('Team (GitHub)', 'other') === 'unknown')
ok('contactPriorityFor(Director of Sourcing) 钳制为 9', contactPriorityFor('Director of Sourcing', 'sourcing') === 9)
ok('Sourcing 总监 > CEO(联系优先级)', contactPriorityFor('Director of Sourcing', 'sourcing') > contactPriorityFor('CEO', 'founder'))

console.log('\nX-Ray LinkedIn 标题解析')
const p1 = parseLinkedInTitle('Jane Smith - Director of Sourcing - Gymshark | LinkedIn')
ok('解析 name=Jane Smith', p1?.name === 'Jane Smith')
ok('解析 title 含 Sourcing', !!p1 && /sourcing/i.test(p1.title))
ok('非人名结果返回 null', parseLinkedInTitle('Top 10 Sourcing Agencies') === null)
ok('空串返回 null', parseLinkedInTitle('') === null)

console.log('\n姓名拆分(toPersonCandidate)')
ok('全名拆 first/last', (() => { const c = toPersonCandidate({ fullName: 'Jane Smith', source: 'xray' }); return c.firstName === 'Jane' && c.lastName === 'Smith' })())
ok('first/last 合 full', toPersonCandidate({ firstName: 'Jane', lastName: 'Smith', source: 'apollo' }).fullName === 'Jane Smith')

console.log('\nAccess Score 阶梯')
ok('无联系人 = 0', computeAccess([]).score === 0)
ok('仅推测邮箱 = 20', computeAccess([{ email: 'a@x.com', email_source: 'guessed', email_confidence: 0.2 }]).score === 20)
ok('已验证(非买手) = 40', computeAccess([verified({ role_type: 'marketing', decision_level: 'influencer' })]).score === 40)
ok('已验证买手 = 60', computeAccess([verified({ role_type: 'sourcing', decision_level: 'influencer' })]).score === 60)
ok('已验证决策人 = 80', computeAccess([verified({ role_type: 'founder', decision_level: 'decision_maker' })]).score === 80)
ok('Champion + 决策人 = 100', computeAccess([
  verified({ id: '1', is_champion: true, role_type: 'operations', decision_level: 'influencer' }),
  verified({ id: '2', role_type: 'sourcing', decision_level: 'decision_maker' }),
]).score === 100)

console.log('\nCoverage / 北极星布尔')
const buyerOnly = computeAccess([verified({ role_type: 'sourcing', decision_level: 'influencer' })])
ok('买手已覆盖(verified)', buyerOnly.coverage.buyer === 'verified')
ok('决策人未覆盖(missing)', buyerOnly.coverage.decisionMaker === 'missing')
ok('买手-only ⇒ 北极星=false', buyerOnly.hasReachableChampionOrDM === false)
ok('已验证决策人 ⇒ 北极星=true', computeAccess([verified({ role_type: 'founder', decision_level: 'decision_maker' })]).hasReachableChampionOrDM === true)
ok('missingRoles 含 Champion(买手-only)', buyerOnly.missingRoles.includes('Champion'))

console.log('\n#2 Hunting cooldown(防紧密重抓循环)')
const now = 1_000_000_000_000
const justNow = new Date(now - 60_000).toISOString()          // 1 min ago
const longAgo = new Date(now - 100 * 60 * 60 * 1000).toISOString() // 100h ago
ok('huntValue: A=high / C=normal', huntValue('A') === 'high' && huntValue('C') === 'normal')
ok('high cadence < normal cadence', huntCadenceMs('high') < huntCadenceMs('normal'))
ok('从未狩猎 ⇒ due', isHuntDue(null, huntCadenceMs('high'), now))
ok('1分钟前狩猎 (high 12h) ⇒ NOT due(循环被挡)', isHuntDue(justNow, huntCadenceMs('high'), now) === false)
ok('100h前 (high 12h) ⇒ due', isHuntDue(longAgo, huntCadenceMs('high'), now) === true)
ok('100h前 (normal 72h) ⇒ due', isHuntDue(longAgo, huntCadenceMs('normal'), now) === true)
ok('companyHuntDue: A 级刚狩猎 ⇒ false', companyHuntDue({ tier: 'A', sourceRaw: { hunt: { last_hunt_at: justNow } }, nowMs: now }) === false)
ok('companyHuntDue: 无 source_raw ⇒ true', companyHuntDue({ tier: 'A', sourceRaw: undefined, nowMs: now }) === true)
ok('stampHunt 写 last_hunt_at 且保留其它键', (() => {
  const r = stampHunt({ foo: 1, hunt: { attempts: 3 } }, justNow)
  const h = r.hunt as Record<string, unknown>
  return r.foo === 1 && h.attempts === 3 && h.last_hunt_at === justNow
})())
ok('lastHuntAt 读出 stamp', lastHuntAt({ hunt: { last_hunt_at: justNow } }) === justNow)

console.log('\n#3 Mail-domain resolver(不对店面子域验证)')
ok('us.oneractive.com → oneractive.com', pickMailDomain({ domain: 'us.oneractive.com' }) === 'oneractive.com')
ok('shop.brand.com → brand.com', pickMailDomain({ domain: 'shop.brand.com' }) === 'brand.com')
ok('https://www.brand.com/x → brand.com', pickMailDomain({ website: 'https://www.brand.com/x' }) === 'brand.com')
ok('shop.brand.co.uk → brand.co.uk (multi-TLD)', pickMailDomain({ domain: 'shop.brand.co.uk' }) === 'brand.co.uk')
ok('已知企业邮箱域优先', pickMailDomain({ knownEmails: ['jane@oneractive.com'], domain: 'us.oneractive.com' }) === 'oneractive.com')
ok('免费邮箱忽略,回退到 domain', pickMailDomain({ knownEmails: ['x@gmail.com'], domain: 'us.brand.com' }) === 'brand.com')
ok('apex 不变 (oneractive.com)', stripStorefront('oneractive.com') === 'oneractive.com')
ok('registrableDomain(a.b.brand.com)=brand.com', registrableDomain('a.b.brand.com') === 'brand.com')

console.log('\n#P0.5 Verification tiers(catch-all 域不再压制)')
ok('Apollo(无SMTP) → trusted/90', (() => { const c = computeCredibility({ email: 'x@oneractive.com', email_source: 'apollo', email_verified: false }); return c.tier === 'trusted' && c.score === 90 })())
ok('RocketReach → trusted', computeCredibility({ email: 'x@y.com', email_source: 'rocketreach' }).tier === 'trusted')
ok('Hunter → verified/100', (() => { const c = computeCredibility({ email: 'x@y.com', email_source: 'hunter' }); return c.tier === 'verified' && c.score === 100 })())
ok('SMTP verified → verified', computeCredibility({ email: 'x@y.com', email_source: 'pattern_smtp', email_verified: true }).tier === 'verified')
ok('pattern_catchall → probable/70', (() => { const c = computeCredibility({ email: 'x@y.com', email_source: 'pattern_catchall' }); return c.tier === 'probable' && c.score === 70 })())
ok('AI 推断 → guessed/40', (() => { const c = computeCredibility({ email: 'x@y.com', email_source: 'ai_inferred' }); return c.tier === 'guessed' && c.score === 40 })())
ok('退信(deliverable=false) → avoid', computeCredibility({ email: 'x@y.com', email_source: 'apollo', email_deliverable: false }).risk === 'avoid')
ok('无邮箱 → none', computeCredibility({}).tier === 'none')

console.log('\n#P0.5 Access/Coverage 认可 trusted(核心修复)')
const tApollo = computeAccess([trusted({ role_type: 'production', decision_level: 'decision_maker' })])
ok('Apollo trusted 决策人 ⇒ 北极星=true(无需SMTP)', tApollo.hasReachableChampionOrDM === true)
ok('Apollo trusted 决策人 ⇒ Access≥80', tApollo.score >= 80)
ok('coverage.decisionMaker=trusted', tApollo.coverage.decisionMaker === 'trusted')
ok('Apollo trusted 买手 ⇒ Access≥60', computeAccess([trusted({ role_type: 'sourcing', decision_level: 'influencer' })]).score >= 60)
ok('probable 决策人 ⇒ 北极星=false(未达可达门槛)', computeAccess([{ email: 'x@y.com', email_source: 'pattern_catchall', role_type: 'founder', decision_level: 'decision_maker' }]).hasReachableChampionOrDM === false)
ok('Champion(trusted)+DM(trusted) ⇒ Access=100', computeAccess([
  trusted({ id: '1', is_champion: true, decision_level: 'influencer', role_type: 'operations' }),
  trusted({ id: '2', decision_level: 'decision_maker', role_type: 'sourcing' }),
]).score === 100)

console.log(`\n结果：${pass} 通过 / ${fail} 失败`)
process.exit(fail > 0 ? 1 : 0)
