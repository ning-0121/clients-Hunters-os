/**
 * Validation for the Quote Intelligence Engine V1.1 (P0).
 *
 *   npx tsx --env-file=.env.local scripts/validate-quote.ts          full (schema + scenarios)
 *   npx tsx scripts/validate-quote.ts scenarios                       scenarios only (no DB)
 *
 * The 3 manual scenarios run against the PURE engine (no DB needed):
 *   A. high strategic value, low profit   → strategic quote allowed, but OWNER APPROVAL
 *   B. ordinary B-tier customer            → normal recommended margin, no approval
 *   C. high risk, low value                → raised floor, no concessions, full-charge sample
 *
 * Hard red lines asserted: below floor → owner approval (strategic only) or forbidden;
 * below strategic margin → always forbidden.
 */
import {
  computeQuoteStrategy, evaluateMargin, STRATEGIC_VALUE_THRESHOLD,
  type QuoteEngineInput,
} from '@/lib/quote/engine'
import { DEFAULT_PRICING } from '@/lib/quote/pricing-config'
import { inferCompetition } from '@/lib/quote/competition'

const phase = process.argv[2] ?? 'full'
let pass = 0, fail = 0
const ok = (n: string, c: boolean, note = '') => {
  if (c) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${n}`) }
  else { fail++; console.error(`  \x1b[31m✗\x1b[0m ${n}${note ? ' — ' + note : ''}`) }
}
const ladderOk = (m: { strategic: number; floor: number; recommended: number; target: number }) =>
  m.strategic <= m.floor + 1e-9 && m.floor <= m.recommended + 1e-9 && m.recommended <= m.target + 1e-9

// ── Scenario A — high strategic value, low profit ───────────────────────────────
function scenarioA() {
  console.log('\n场景 A — 高战略价值低利润客户（大型连锁 / 比价 / 强竞争）')
  const input: QuoteEngineInput = {
    qty: 5000, fabricComplexity: 'medium',
    customerTier: 'A',
    intentScore: 8, productMatchScore: 9, customerScaleScore: 9,
    ltvPotentialScore: 9, replyProbabilityScore: 7, contactQualityScore: 8,
    estimatedAnnualRevenue: '>$1B', targetCustomerSegment: 'retailer_chain',
    instagramFollowers: 2_000_000, tiktokFollowers: 1_500_000,
    fundingDetected: true, newProductsDetected: true,
    isPriceComparing: true, competitionLevel: 'strong',
    orderCount: 0, creditRiskScore: 3, creditBand: '低风险',
  }
  const s = computeQuoteStrategy(input, DEFAULT_PRICING.leggings)
  const m = s.margins
  console.log(`    战略价值=${s.scores.strategicValue.score} 成交=${s.scores.winProbability.score} 风险=${s.scores.risk.score} | 战略${(m.strategic * 100).toFixed(1)}% 底线${(m.floor * 100).toFixed(1)}% 推荐${(m.recommended * 100).toFixed(1)}% 目标${(m.target * 100).toFixed(1)}%`)
  ok('战略价值 ≥ 阈值', s.scores.strategicValue.score >= STRATEGIC_VALUE_THRESHOLD, `${s.scores.strategicValue.score} < ${STRATEGIC_VALUE_THRESHOLD}`)
  ok('识别为战略客户', s.isStrategicCustomer)
  ok('解锁战略报价 → 需老板审批', s.requiresOwnerApproval)
  ok('战略底线 < 普通底线', m.strategic < m.floor)
  ok('利润率阶梯有序 (战略≤底线≤推荐≤目标)', ladderOk(m))
  const mid = (m.strategic + m.floor) / 2
  ok('战略区间报价 → owner_approval', evaluateMargin(mid, m, true).status === 'owner_approval', evaluateMargin(mid, m, true).status)
  ok('低于战略底线 → forbidden', evaluateMargin(m.strategic - 0.01, m, true).status === 'forbidden')
  ok('战略提示包含「仅老板审批」', !!s.strategicNote && /老板审批/.test(s.strategicNote))
  ok('输出标记为 recommendation', s.kind === 'recommendation')
}

// ── Scenario B — ordinary B-tier customer ───────────────────────────────────────
function scenarioB() {
  console.log('\n场景 B — 普通 B 类客户')
  const input: QuoteEngineInput = {
    qty: 1500, fabricComplexity: 'medium',
    customerTier: 'B',
    intentScore: 6, productMatchScore: 7, customerScaleScore: 6,
    ltvPotentialScore: 6, replyProbabilityScore: 6, contactQualityScore: 6,
    estimatedAnnualRevenue: '$20M', targetCustomerSegment: 'brand_owner',
    instagramFollowers: 30_000,
    isPriceComparing: false, competitionLevel: 'normal',
    orderCount: 1, hasRepeatOrder: false,
    creditRiskScore: 4, creditBand: '中等',
  }
  const s = computeQuoteStrategy(input, DEFAULT_PRICING.leggings)
  const m = s.margins
  console.log(`    战略价值=${s.scores.strategicValue.score} 成交=${s.scores.winProbability.score} 风险=${s.scores.risk.score} | 底线${(m.floor * 100).toFixed(1)}% 推荐${(m.recommended * 100).toFixed(1)}% 目标${(m.target * 100).toFixed(1)}% 报价$${s.prices.recommended}/件`)
  ok('非战略客户', !s.isStrategicCustomer)
  ok('不需要老板审批', !s.requiresOwnerApproval)
  ok('利润率阶梯有序', ladderOk(m))
  ok('推荐利润率 ≥ 底线', m.recommended >= m.floor)
  ok('按推荐价报价 → ok', evaluateMargin(m.recommended, m, false).status === 'ok')
  ok('低于底线（非战略）→ forbidden', evaluateMargin(m.floor - 0.01, m, false).status === 'forbidden')
}

// ── Scenario C — high risk, low value ───────────────────────────────────────────
function scenarioC() {
  console.log('\n场景 C — 高风险低价值客户（比价 / 红海 / 新客户 / 多次取样未成交）')
  const input: QuoteEngineInput = {
    qty: 80, fabricComplexity: 'high',
    customerTier: 'D',
    intentScore: 2, productMatchScore: 3, customerScaleScore: 2,
    ltvPotentialScore: 2, replyProbabilityScore: 2,
    estimatedAnnualRevenue: '$500K', targetCustomerSegment: 'dtc_brand',
    isPriceComparing: true, competitionLevel: 'extreme',
    orderCount: 0, unconvertedSampleCount: 3,
    creditRiskScore: 8, creditBand: '偏高',
  }
  const s = computeQuoteStrategy(input, DEFAULT_PRICING.jacket)
  const m = s.margins
  const hasNoDiscountRule = s.negotiation.forbid.some((r) => /降价|让利|首报/.test(r.label))
  const hasPriceConcessionAllow = s.negotiation.allow.some((r) => /让步/.test(r.label))
  console.log(`    战略价值=${s.scores.strategicValue.score} 成交=${s.scores.winProbability.score} 风险=${s.scores.risk.score} | 基准底线${(DEFAULT_PRICING.jacket.floorMargin * 100).toFixed(1)}% → 实际底线${(m.floor * 100).toFixed(1)}% 样品=${s.samplePolicy.policy}`)
  ok('风险分高 (≥60)', s.scores.risk.score >= 60, `${s.scores.risk.score}`)
  ok('底线被风险溢价抬高', m.floor > DEFAULT_PRICING.jacket.floorMargin)
  ok('不需要老板审批（非战略）', !s.requiresOwnerApproval)
  ok('禁止清单含「不建议降价/首报最低」', hasNoDiscountRule)
  ok('不提供价格让步（高风险）', !hasPriceConcessionAllow)
  ok('样品策略 = 全额收费', s.samplePolicy.policy === 'full')
  ok('低于底线 → forbidden', evaluateMargin(m.floor - 0.01, m, false).status === 'forbidden')
}

// ── P1 #6 — competition inference (pure) ────────────────────────────────────────
function scenarioCompetition() {
  console.log('\nP1 #6 — 竞争维度推断（海关供应商数）')
  const many = inferCompetition({ supplierHints: ['A Co', 'B Co', 'C Co', 'D Co', 'E Co'] })
  ok('5+ 供应商 → 强竞争 + 比价', many.competitionLevel === 'strong' && many.isPriceComparing === true)
  const one = inferCompetition({ supplierHints: ['Only Supplier'] })
  ok('单一供应商 → 弱竞争 + 不比价', one.competitionLevel === 'weak' && one.isPriceComparing === false)
  const budget = inferCompetition({ supplierHints: ['X', 'Y'], pricePoint: 'budget' })
  ok('低价位 → 推断比价 + 竞争上调', budget.isPriceComparing === true && budget.competitionLevel === 'strong')
  const none = inferCompetition({ supplierHints: [] })
  ok('无供应商线索 → 不推断', none.competitionLevel === null && none.isPriceComparing === null)
}

// ── Schema / migration check (DB) — informational unless DB reachable ────────────
async function schemaCheck(): Promise<'ok' | 'missing' | 'unreachable'> {
  console.log('\nMigration / schema 检查（010 + 011）')
  try {
    const { createDirectClient } = await import('@/lib/supabase/server')
    const sb = createDirectClient()
    const { error: pcErr } = await sb.from('pricing_config').select('category').limit(1)
    const { error: qsErr } = await sb.from('quote_strategies').select('id').limit(1)
    const { error: acErr } = await sb.from('acquisition_costs').select('id').limit(1)
    const { error: colErr } = await sb.from('companies').select('is_price_comparing, competition_level').limit(1)
    const { error: msgErr } = await sb.from('quote_strategies').select('quote_message').limit(1) // migration 011
    const errs = [pcErr, qsErr, acErr, colErr, msgErr].filter(Boolean)
    if (errs.length) {
      const msg = errs.map((e) => e!.message).join(' | ')
      if (/fetch failed|ENOTFOUND|network|getaddrinfo/i.test(msg)) {
        console.log('  ⚠ 无法连接数据库（离线/无凭据）— 跳过 schema 检查')
        return 'unreachable'
      }
      ok('[010] pricing_config 表存在', !pcErr, pcErr?.message)
      ok('[010] quote_strategies 表存在', !qsErr, qsErr?.message)
      ok('[010] acquisition_costs 表存在', !acErr, acErr?.message)
      ok('[010] companies 新增列存在', !colErr, colErr?.message)
      ok('[011] quote_strategies.quote_message 列存在', !msgErr, msgErr?.message)
      if (pcErr || qsErr || acErr || colErr) console.error('\n  → 请应用 supabase/migrations/010_quote_intelligence.sql')
      if (msgErr) console.error('  → 请应用 supabase/migrations/011_quote_intelligence_p1.sql')
      return 'missing'
    }
    ok('[010] pricing_config / quote_strategies / acquisition_costs 表 + companies 列', true)
    ok('[011] quote_strategies.quote_message 列存在', true)
    return 'ok'
  } catch (e) {
    console.log(`  ⚠ schema 检查跳过：${String(e instanceof Error ? e.message : e)}`)
    return 'unreachable'
  }
}

async function main() {
  console.log('═══ Quote Intelligence Engine — P0 验证 ═══')
  if (phase !== 'scenarios') await schemaCheck()
  scenarioA()
  scenarioB()
  scenarioC()
  scenarioCompetition()
  console.log(`\n结果：${pass} 通过 / ${fail} 失败`)
  if (fail > 0) process.exit(1)
}

main()
