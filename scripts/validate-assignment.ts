/**
 * Assignment smoke — verifies lead assignment works after migration 012
 * (companies.assigned_to is TEXT, keyed by the login email).
 *
 *   npx tsx --env-file=.env.local scripts/validate-assignment.ts
 *
 * Mirrors the /bd/today "我的客户" query + KPI count, and proves the column now
 * accepts an email owner. Browser smoke (logged in) covers the badge + UI.
 */
import { createDirectClient } from '@/lib/supabase/server'

const sb = createDirectClient()
const OWNER = 'assign-smoke@validation.test'
const DOMAIN = 'assign-smoke.validation.test'
let pass = 0, fail = 0
const ok = (n: string, c: boolean, extra = '') => {
  if (c) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${n}`) }
  else { fail++; console.error(`  \x1b[31m✗\x1b[0m ${n}${extra ? ' — ' + extra : ''}`) }
}

async function main() {
  await sb.from('companies').delete().eq('domain', DOMAIN) // clean prior

  // Assign-write: fails outright if the column is still uuid (the original bug).
  const { data: co, error } = await sb.from('companies').insert({
    name: 'Assign Smoke (validation)', domain: DOMAIN, source: 'validation',
    customer_tier: 'B', status: 'awaiting_contact', total_score: 60, assigned_to: OWNER,
  }).select('id, assigned_to').single()
  if (error) {
    console.error(`\n✗ 写入 assigned_to=邮箱 失败 —— 多半是 migration 012 未应用：${error.message}`)
    console.error('  → 请在 Supabase SQL Editor 应用 supabase/migrations/012_fix_assignment_identity.sql')
    process.exit(1)
  }
  ok('assigned_to 接受邮箱（列已是 TEXT）', co?.assigned_to === OWNER)

  // Same query shape as /bd/today "我的客户".
  const { data: mine } = await sb.from('companies')
    .select('id, status, assigned_to')
    .eq('assigned_to', OWNER).in('customer_tier', ['A', 'B', 'C'])
    .neq('status', 'closed_lost').neq('status', 'closed_won')
  ok('「我的客户」查询按邮箱匹配到该客户', (mine ?? []).some((c) => c.id === co!.id))

  // KPI count (assignedCount on /bd/today).
  const { count } = await sb.from('companies').select('*', { count: 'exact', head: true }).eq('assigned_to', OWNER)
  ok('「我的客户」KPI 计数 ≥ 1', (count ?? 0) >= 1)

  // awaiting_contact present → the badge precondition holds.
  ok('该客户 status=awaiting_contact（徽章前置条件）',
    (mine ?? []).find((c) => c.id === co!.id)?.status === 'awaiting_contact')

  await sb.from('companies').delete().eq('domain', DOMAIN) // cleanup
  console.log(`\n结果：${pass} 通过 / ${fail} 失败`)
  process.exit(fail > 0 ? 1 : 0)
}
main()
