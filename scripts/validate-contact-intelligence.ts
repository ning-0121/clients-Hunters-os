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

let pass = 0, fail = 0
const ok = (n: string, c: boolean) => { if (c) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${n}`) } else { fail++; console.error(`  \x1b[31m✗\x1b[0m ${n}`) } }

const apollo = (title: string): ApolloContact => ({ firstName: 'A', lastName: 'B', fullName: 'A B', title })
const verified = (x: Partial<AccessContact>): AccessContact => ({ email: 'a@x.com', email_verified: true, ...x })

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
ok('买手-only ⇒ 北极星=false', buyerOnly.hasVerifiedChampionOrDM === false)
ok('已验证决策人 ⇒ 北极星=true', computeAccess([verified({ role_type: 'founder', decision_level: 'decision_maker' })]).hasVerifiedChampionOrDM === true)
ok('missingRoles 含 Champion(买手-only)', buyerOnly.missingRoles.includes('Champion'))

console.log(`\n结果：${pass} 通过 / ${fail} 失败`)
process.exit(fail > 0 ? 1 : 0)
