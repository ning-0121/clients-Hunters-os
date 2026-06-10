import { createDirectClient } from '@/lib/supabase/server'
const sb = createDirectClient()

async function main() {
  const { data: companies } = await sb.from('companies').select('id, name, target_customer_segment').eq('source', 'validation')
  const ids = (companies ?? []).map(c => c.id)
  const nameOf = (id: string) => companies?.find(c => c.id === id)?.name ?? id

  // Latest generate_report action per company (full error_message)
  const { data: actions } = await sb.from('agent_actions')
    .select('company_id, status, error_message, created_at')
    .in('company_id', ids).eq('action_type', 'generate_report')
    .order('created_at', { ascending: false })

  const seen = new Set<string>()
  console.log('=== generate_report (latest per company) ===')
  for (const a of actions ?? []) {
    if (seen.has(a.company_id)) continue
    seen.add(a.company_id)
    console.log(`\n[${a.status}] ${nameOf(a.company_id)}`)
    console.log(`  ${a.error_message ?? '(none)'}`)
  }

  // Report kind counts + reviews/drafts per company
  console.log('\n=== reports / reviews / drafts ===')
  for (const c of companies ?? []) {
    const { data: reps } = await sb.from('customer_intelligence_reports')
      .select('report_version, report_kind').eq('company_id', c.id).order('report_version', { ascending: false })
    const { count: reviews } = await sb.from('report_quality_reviews').select('*', { count: 'exact', head: true }).eq('company_id', c.id)
    const { count: drafts } = await sb.from('outreach_logs').select('*', { count: 'exact', head: true }).eq('company_id', c.id)
    console.log(`${c.name} | seg=${c.target_customer_segment} | reports=${(reps ?? []).map(r => `v${r.report_version}/${r.report_kind}`).join(',') || 'NONE'} | reviews=${reviews} | drafts=${drafts}`)
  }
}
main().catch(e => { console.error(e); process.exit(1) })
