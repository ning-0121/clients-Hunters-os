/**
 * Runtime Validation Sprint — proves the Tiering + Report + Factory system is
 * useful for real QIMO business development.
 *
 *   npm run validate            full run (schema → seed → pipeline → report)
 *   npm run validate -- schema  schema check only (read-only)
 *   npm run validate -- clean   delete the validation companies + their data
 *
 * Tests 10 companies end-to-end (5 overseas, 5 domestic Chinese trading cos):
 *   tier classification → intelligence report → factory match → outreach draft → quality review
 *
 * Safety invariant checked: a customer requiring a valid social audit
 * (SMETA / customer audit / supplier portal) is NEVER routed to the QIMO own
 * factory (whose BSCI/WRAP are expired) — only to a partner factory or "not ready".
 *
 * Requires .env.local: SUPABASE creds + ARAOS_ANTHROPIC_API_KEY.
 */
import { createDirectClient } from '@/lib/supabase/server'
import { AgentFactory } from '@/agents/agent-factory'
import { recommendFactoryForCompany } from '@/lib/factory/recommend'
import { isTransientError } from '@/lib/util/retry'

const sb = createDirectClient()
const VAL_SOURCE = 'validation'
const phase = process.argv[2] ?? 'full'

let pass = 0, fail = 0
const ok = (n: string, c: boolean, note = '') => { if (c) { pass++; console.log(`  ✓ ${n}`) } else { fail++; console.error(`  ✗ ${n}${note ? ' — ' + note : ''}`) } }

// ── Seed data ────────────────────────────────────────────────────────────────
interface SeedCompany {
  name: string; domain: string; website: string; country: string
  company_type?: string; product_categories: string[]; description: string
  employee_count_range?: string; estimated_annual_revenue?: string
  // domestic-only:
  domestic?: boolean
  target_customer_segment?: string; domestic_company_type?: string; domestic_region?: string
}

const OVERSEAS: SeedCompany[] = [
  { name: 'Decathlon (validation)', domain: 'decathlon.validation.test', website: 'https://decathlon.validation.test',
    country: 'France', company_type: 'retailer_chain', employee_count_range: '500+', estimated_annual_revenue: '>$1B',
    product_categories: ['activewear', 'leggings', 'sports_bra', 'yoga'],
    description: 'Global sporting-goods retailer with own activewear brands, strict supplier code of conduct, formal vendor portal and SMETA/Sedex social-audit requirements before onboarding any supplier.' },
  { name: 'Yamamay (validation)', domain: 'yamamay.validation.test', website: 'https://yamamay.validation.test',
    country: 'Italy', company_type: 'brand_owner', employee_count_range: '201-500',
    product_categories: ['lounge', 'seamless', 'underwear', 'activewear'],
    description: 'Italian intimate, beachwear and athleisure brand with a large retail chain across Europe. Sources seamless and lounge sets; quality and compliance conscious.' },
  { name: 'Vitality Activewear (validation)', domain: 'vitality.validation.test', website: 'https://vitality.validation.test',
    country: 'United States', company_type: 'dtc_brand', employee_count_range: '11-50',
    product_categories: ['activewear', 'leggings', 'sports_bra'],
    description: 'US direct-to-consumer activewear brand on Shopify, ~$3M revenue, growing on TikTok. Open to private-label OEM partners, flexible MOQ, basic company documents only.' },
  { name: 'Aurora Sports Imports (validation)', domain: 'aurora.validation.test', website: 'https://aurora.validation.test',
    country: 'United Kingdom', company_type: 'importer', employee_count_range: '11-50',
    product_categories: ['activewear', 'fleece', 'leggings'],
    description: 'UK activewear importer and distributor supplying regional retailers. Requires BSCI/WRAP and OEKO-TEX from factories. Real recurring order potential.' },
  { name: 'Bloom Yoga Co (validation)', domain: 'bloomyoga.validation.test', website: 'https://bloomyoga.validation.test',
    country: 'United States', company_type: 'dtc_brand', employee_count_range: '1-10',
    product_categories: ['yoga', 'leggings'],
    description: 'Very early-stage DTC yoga-wear startup, tiny volume, sample-driven, price-sensitive. Good for a quick test order but high communication overhead.' },
]

const DOMESTIC: SeedCompany[] = [
  { name: '义乌锦绣服装外贸有限公司 (validation)', domain: 'jinxiu.validation.test', website: 'https://jinxiu.validation.test',
    country: 'China', domestic: true, target_customer_segment: 'domestic_trading_company',
    domestic_company_type: 'apparel_trading_company', domestic_region: '义乌',
    product_categories: ['运动服', '瑜伽服', 'leggings'],
    description: '义乌服装外贸公司，主营运动服、瑜伽服出口欧美。订单量稳定，目前用Excel管理跟单，近期招聘外贸业务员和跟单，订单管理混乱，有上系统的需求。' },
  { name: '杭州动越运动服饰贸易 (validation)', domain: 'dongyue.validation.test', website: 'https://dongyue.validation.test',
    country: 'China', domestic: true, target_customer_segment: 'domestic_trading_company',
    domestic_company_type: 'activewear_trading_company', domestic_region: '杭州',
    product_categories: ['运动服', 'leggings', '运动内衣'],
    description: '杭州运动服饰贸易公司，专做运动服、瑜伽裤出口，客户在美国和澳洲。希望扩大海外客户开发，关注外贸客户开发系统和CRM。' },
  { name: '宁波环球进出口有限公司 (validation)', domain: 'huanqiu.validation.test', website: 'https://huanqiu.validation.test',
    country: 'China', domestic: true, target_customer_segment: 'domestic_trading_company',
    domestic_company_type: 'general_import_export_company', domestic_region: '宁波',
    product_categories: ['服装', '运动服'],
    description: '宁波综合进出口公司，服装是主要品类之一，出口欧洲为主。订单合作潜力较好，管理较传统。' },
  { name: '深圳跨境优选电商 (validation)', domain: 'kuajing.validation.test', website: 'https://kuajing.validation.test',
    country: 'China', domestic: true, target_customer_segment: 'domestic_trading_company',
    domestic_company_type: 'cross_border_ecommerce_seller', domestic_region: '深圳',
    product_categories: ['运动服', 'activewear'],
    description: '深圳跨境电商卖家，在亚马逊和独立站卖运动服，团队在扩张，急需订单与客户管理系统，软件需求强，自有采购但下单量中等。' },
  { name: '广州凌云外贸跟单代理 (validation)', domain: 'lingyun.validation.test', website: 'https://lingyun.validation.test',
    country: 'China', domestic: true, target_customer_segment: 'domestic_trading_company',
    domestic_company_type: 'sourcing_agent', domestic_region: '广州',
    product_categories: ['运动服', '瑜伽服'],
    description: '广州外贸跟单/采购代理，为海外客户找工厂下单，渠道资源多，适合渠道合作；自身也在招聘跟单，跟单流程靠人工。' },
]

const ALL = [...OVERSEAS, ...DOMESTIC]

// ── Phase: schema ──────────────────────────────────────────────────────────
async function checkSchema() {
  console.log('\n[1] Migration 005 schema check')
  const tableCols: [string, string][] = [
    ['report_quality_reviews', 'id, overall_score, usefulness_score, compliance_accuracy_score, product_match_score, next_action_quality_score, notes'],
    ['factory_profiles', 'id, name, factory_type, main_categories, price_level'],
    ['factory_certifications', 'id, factory_id, certification_type, status'],
    ['factory_capabilities', 'id, factory_id, capability_level, suitable_customer_tiers'],
    ['companies', 'customer_tier, compliance_level, recommended_factory_type, recommended_factory_id, target_customer_segment, domestic_company_type, development_purpose, order_partner_potential_score, software_customer_potential_score, management_pain_signals, recruitment_signals, domestic_region, recommended_domestic_strategy, product_match'],
    ['customer_intelligence_reports', 'report_kind, domestic_report'],
  ]
  for (const [table, cols] of tableCols) {
    const { error } = await sb.from(table).select(cols).limit(1)
    ok(`${table} has expected columns`, !error, error?.message)
  }
  const { count } = await sb.from('factory_profiles').select('*', { count: 'exact', head: true })
  ok('factory_profiles seeded (>=2: own + partner)', (count ?? 0) >= 2, `found ${count}`)
  const { data: own } = await sb.from('factory_profiles').select('id').eq('factory_type', 'own_factory').limit(1).maybeSingle()
  const { data: partner } = await sb.from('factory_profiles').select('id').eq('factory_type', 'partner_factory').limit(1).maybeSingle()
  ok('own factory present', !!own)
  ok('partner factory present', !!partner)
}

// ── Phase: clean ─────────────────────────────────────────────────────────────
async function clean() {
  console.log('\n[clean] removing validation companies')
  const { data } = await sb.from('companies').select('id').eq('source', VAL_SOURCE)
  const ids = (data ?? []).map((r) => r.id)
  if (ids.length === 0) { console.log('  nothing to clean'); return }
  // cascade deletes reports/reviews via FKs; also clean outreach/tasks explicitly
  await sb.from('outreach_logs').delete().in('company_id', ids)
  await sb.from('tasks').delete().in('company_id', ids)
  await sb.from('companies').delete().in('id', ids)
  console.log(`  removed ${ids.length} validation companies`)
}

/** Retry a flaky network op (sandbox Supabase connections occasionally reset). */
async function withRetry<T>(label: string, fn: () => Promise<T>, attempts = 4): Promise<T> {
  let lastErr: unknown
  for (let i = 1; i <= attempts; i++) {
    try { return await fn() }
    catch (e) {
      lastErr = e
      if (i < attempts) { console.log(`    (retry ${i}/${attempts - 1} on ${label})`); await new Promise(r => setTimeout(r, 1000 * i)) }
    }
  }
  throw lastErr
}

async function upsertSeed(c: SeedCompany): Promise<string> {
  return withRetry(`seed ${c.name}`, () => upsertSeedOnce(c))
}

/**
 * Supabase insert that retries transient failures (thrown fetch errors, or
 * transient .error). Deterministic errors are returned without retry.
 */
async function insertWithRetry(
  label: string,
  fn: () => PromiseLike<{ error: { message: string } | null }>,
): Promise<{ error: { message: string } | null }> {
  try {
    return await withRetry(label, async () => {
      const res = await fn()                              // throws on transient network failure
      if (res.error && isTransientError(res.error)) throw new Error(res.error.message)
      return res
    })
  } catch (e) {
    return { error: { message: e instanceof Error ? e.message : String(e) } }
  }
}

async function upsertSeedOnce(c: SeedCompany): Promise<string> {
  const { data: existing } = await sb.from('companies').select('id').eq('domain', c.domain).maybeSingle()
  const row: Record<string, unknown> = {
    name: c.name, domain: c.domain, website: c.website, country: c.country,
    company_type: c.company_type, product_categories: c.product_categories,
    description: c.description, employee_count_range: c.employee_count_range,
    estimated_annual_revenue: c.estimated_annual_revenue, source: VAL_SOURCE, status: 'enriched',
    target_customer_segment: c.target_customer_segment ?? 'overseas_brand',
    domestic_company_type: c.domestic_company_type ?? null,
    domestic_region: c.domestic_region ?? null,
    updated_at: new Date().toISOString(),
  }
  if (existing) { await sb.from('companies').update(row).eq('id', existing.id); return existing.id }
  const { data, error } = await sb.from('companies').insert(row).select('id').single()
  if (error || !data) throw new Error(`seed failed for ${c.name}: ${error?.message}`)
  return data.id
}

async function runAgent(jobType: string, input: Record<string, unknown>): Promise<{ ok: boolean; error?: string }> {
  let last: { ok: boolean; error?: string } = { ok: false }
  for (let i = 1; i <= 2; i++) {           // one retry — covers transient network blips
    try {
      const agent = AgentFactory.create(jobType)
      const r = await agent.execute({}, input)
      last = { ok: r.success, error: r.error }
    } catch (e) { last = { ok: false, error: String(e) } }
    if (last.ok) return last
    if (i < 2) await new Promise(r => setTimeout(r, 1500))
  }
  return last
}

interface ResultRow {
  name: string; tier: string; reportKind: string; factoryDecision: string
  developmentPurpose: string; outreachDraft: boolean; reviewSubmitted: boolean
  usefulness: number; orderScore: string; softwareScore: string
  notes: string; passed: boolean
}

async function validateCompany(c: SeedCompany): Promise<ResultRow> {
  const notes: string[] = []
  const id = await upsertSeed(c)

  // 1. Tier / score (overseas → tiering, domestic → domestic scoring)
  if (c.domestic) {
    const r = await runAgent('score_domestic', { companyId: id, queueReport: false })
    if (!r.ok) notes.push(`score_domestic failed: ${r.error}`)
  } else {
    const r = await runAgent('tier_company', { companyId: id, queueReport: false })
    if (!r.ok) notes.push(`tier_company failed: ${r.error}`)
  }

  // 2. Intelligence report
  const rep = await runAgent('generate_report', { companyId: id, manual: true })
  if (!rep.ok) notes.push(`report failed: ${rep.error}`)

  // Reload company + latest report
  const { data: company } = await sb.from('companies').select('*').eq('id', id).single()
  const { data: report } = await sb.from('customer_intelligence_reports')
    .select('*').eq('company_id', id).order('report_version', { ascending: false }).limit(1).maybeSingle()

  // 3. Factory match (deterministic)
  const match = company ? await recommendFactoryForCompany(company).catch(() => null) : null
  const factoryDecision = c.domestic ? 'n/a (domestic)' : (match?.decision ?? 'none')

  // 4. Outreach draft from report
  let outreachDraft = false
  if (report) {
    const dm = (report.draft_messages ?? {}) as Record<string, unknown>
    const email = (dm.first_outreach_email ?? dm.formal_email ?? {}) as { subject?: string; body?: string }
    if (email.subject || email.body) {
      const { data: contact } = await sb.from('contacts').select('id').eq('company_id', id).limit(1).maybeSingle()
      const { error } = await insertWithRetry(`outreach ${c.name}`, () => sb.from('outreach_logs').insert({
        company_id: id, contact_id: contact?.id ?? null, channel: 'email', direction: 'outbound',
        subject: email.subject ?? 'Intro', body: email.body ?? '',
        personalization_data: { from_report: report.id, validation: true },
        status: 'pending_approval', executed_by: 'ai',
      }))
      outreachDraft = !error
      if (error) notes.push(`outreach insert: ${error.message}`)
    } else notes.push('no draft email in report')
  }

  // 5. Quality review (heuristic auto-review; human review still available in UI)
  const usefulness = report ? computeUsefulness(report, c.domestic ?? false, outreachDraft) : 0
  let reviewSubmitted = false
  if (report) {
    const { error } = await insertWithRetry(`review ${c.name}`, () => sb.from('report_quality_reviews').insert({
      company_id: id, report_id: report.id, reviewer: 'auto-validation',
      overall_score: usefulness, usefulness_score: usefulness,
      accuracy_score: clampReview(usefulness - 1), compliance_accuracy_score: clampReview(usefulness - 1),
      product_match_score: clampReview(usefulness), next_action_quality_score: clampReview(usefulness),
      notes: `Auto-validation heuristic. ${notes.join('; ') || 'clean run'}`,
    }))
    reviewSubmitted = !error
    if (error) notes.push(`review insert: ${error.message}`)
  }

  // ── Per-company safety: strict-audit customer must NOT use expired own factory
  if (!c.domestic && company) {
    const lvl = company.compliance_level
    const strict = ['sedex_smeta', 'customer_audit', 'supplier_portal'].includes(lvl)
    if (strict) {
      const safe = match?.decision === 'partner' || match?.decision === 'not_ready'
      ok(`SAFETY: ${c.name} (${lvl}) not routed to expired own factory`, safe, `decision=${match?.decision}`)
      if (!safe) notes.push('DANGEROUS: strict-audit customer routed to own factory')
    }
  }

  const passed = !!report && (c.domestic ? true : !!match)
  return {
    name: c.name, tier: company?.customer_tier ?? '—',
    reportKind: report?.report_kind ?? '—', factoryDecision,
    developmentPurpose: company?.development_purpose ?? (c.domestic ? '—' : 'n/a'),
    outreachDraft, reviewSubmitted, usefulness,
    orderScore: company?.order_partner_potential_score != null ? String(company.order_partner_potential_score) : '—',
    softwareScore: company?.software_customer_potential_score != null ? String(company.software_customer_potential_score) : '—',
    notes: notes.join('; ') || 'ok', passed,
  }
}

function clampReview(n: number): number { return Math.max(1, Math.min(10, Math.round(n))) }

function computeUsefulness(report: Record<string, unknown>, domestic: boolean, outreachDraft: boolean): number {
  let s = 4
  const draft = (report.draft_messages ?? {}) as Record<string, unknown>
  if (domestic) {
    const dom = (report.domestic_report ?? {}) as Record<string, unknown>
    if (str(dom.推荐合作模式)) s++
    if (deep(dom, '订单合作可能性', '说明')) s++
    if (deep(dom, '软件系统需求可能性', '说明')) s++
    if (str(draft.wechat_message)) s++
    if (deep(draft, 'formal_email', 'body')) s++
    if (Array.isArray(dom.下一步动作) && (dom.下一步动作 as unknown[]).length > 0) s++
  } else {
    const exec = (report.executive_summary ?? {}) as Record<string, unknown>
    const pm = Array.isArray(report.product_match) ? (report.product_match as Record<string, unknown>[]) : []
    const comp = (report.compliance_requirements ?? {}) as Record<string, unknown>
    if (str(exec.next_step)) s++
    if (pm.some((p) => ['High', 'Medium'].includes(String(p.match_level)))) s++
    if (Array.isArray(comp.items) && (comp.items as unknown[]).length > 0) s++
    if (deep(draft, 'first_outreach_email', 'body')) s++
    if (outreachDraft) s++
  }
  return Math.max(1, Math.min(10, s))
}

const str = (v: unknown): boolean => typeof v === 'string' && v.trim().length > 0
const deep = (o: Record<string, unknown>, a: string, b: string): boolean => {
  const inner = (o[a] ?? {}) as Record<string, unknown>
  return str(inner[b])
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`=== ARAOS Validation Sprint (phase: ${phase}) ===`)

  if (phase === 'clean') { await clean(); return }

  await checkSchema()
  if (phase === 'schema') {
    console.log(`\n${fail === 0 ? '✅' : '❌'} schema: ${pass} passed, ${fail} failed`)
    process.exit(fail === 0 ? 0 : 1)
  }
  if (fail > 0) {
    console.error('\n❌ Schema check failed — apply migration 005 before running the full validation.')
    process.exit(1)
  }

  console.log('\n[2] End-to-end pipeline on 10 companies (5 overseas + 5 domestic)')
  const rows: ResultRow[] = []
  for (const c of ALL) {
    process.stdout.write(`  • ${c.name} … `)
    try {
      const row = await validateCompany(c)
      console.log(row.passed ? 'done' : 'ISSUES')
      rows.push(row)
    } catch (e) {
      console.log('ERROR')
      rows.push({
        name: c.name, tier: '—', reportKind: '—', factoryDecision: '—',
        developmentPurpose: '—', outreachDraft: false, reviewSubmitted: false,
        usefulness: 0, orderScore: '—', softwareScore: '—',
        notes: `fatal: ${String(e).slice(0, 160)}`, passed: false,
      })
    }
  }

  // ── Output table ──
  console.log('\n[3] Validation output')
  console.log('─'.repeat(120))
  console.log(
    pad('Company', 34) + pad('Tier', 6) + pad('Kind', 10) + pad('Factory', 12) +
    pad('Purpose', 18) + pad('Draft', 7) + pad('Review', 8) + pad('Useful', 7),
  )
  console.log('─'.repeat(120))
  for (const r of rows) {
    console.log(
      pad(r.name, 34) + pad(r.tier, 6) + pad(r.reportKind, 10) + pad(r.factoryDecision, 12) +
      pad(r.developmentPurpose, 18) + pad(r.outreachDraft ? 'yes' : 'NO', 7) +
      pad(r.reviewSubmitted ? 'yes' : 'NO', 8) + pad(`${r.usefulness}/10`, 7),
    )
    if (r.notes !== 'ok') console.log(`      ↳ ${r.notes}`)
  }
  console.log('─'.repeat(120))

  // ── Acceptance assertions ──
  console.log('\n[4] Acceptance criteria')
  ok('10 companies tested end-to-end', rows.length === 10)
  ok('all reports generated', rows.every((r) => r.reportKind !== '—'))
  const rated7 = rows.filter((r) => r.usefulness >= 7).length
  ok(`>=5 reports rated 7/10+ for usefulness (got ${rated7})`, rated7 >= 5)
  ok('all reviews submitted', rows.every((r) => r.reviewSubmitted))
  const overseasRows = rows.slice(0, 5), domesticRows = rows.slice(5)
  ok('overseas reports are kind=overseas', overseasRows.every((r) => r.reportKind === 'overseas'))
  ok('domestic reports are kind=domestic', domesticRows.every((r) => r.reportKind === 'domestic'))
  ok('overseas have factory decision', overseasRows.every((r) => r.factoryDecision !== 'none' && r.factoryDecision !== '—'))
  ok('domestic have order/software scores', domesticRows.every((r) => r.orderScore !== '—' && r.softwareScore !== '—'))

  console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} passed, ${fail} failed`)
  console.log('\nNote: usefulness here is a heuristic completeness score. Open each report at')
  console.log('/companies/[id]/report to submit a real human 1-10 review. Run "npm run validate -- clean" to remove validation data.')
  process.exit(fail === 0 ? 0 : 1)
}

function pad(s: string, n: number): string {
  const str = s.length > n - 1 ? s.slice(0, n - 2) + '…' : s
  return str.padEnd(n, ' ')
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1) })
