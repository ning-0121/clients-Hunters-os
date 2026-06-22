/**
 * System Health Dashboard (CLI) — `npm run health`.
 * Prints the guardian metrics + verdict. Exit 1 if any guardian is tripped
 * (so it can gate CI / cron alerts).
 */
import { createDirectClient } from '@/lib/supabase/server'
import { checkGuardians } from '@/lib/ops/guardian'

async function main() {
  const sb = createDirectClient()
  const v = await checkGuardians(sb)
  const m = v.metrics

  console.log('\n════════ QIMO SYSTEM HEALTH ════════')
  console.log('agent_queue size:        ', m.agentQueueSize, `(waiting/active: ${m.waitingActive})`)
  console.log('pending_approval drafts: ', m.pendingDrafts)
  console.log('jobs created last hour:  ', m.jobsLastHour)
  console.log('AI drafts last 24h:      ', m.aiDraftsLast24h)
  console.log('est LLM cost last 24h:   ', `~$${m.estCostLast24hUSD}`)
  console.log('────────────────────────────────────')
  if (v.ok) {
    console.log('✅ ALL GUARDIANS GREEN — no runaway, no duplicate flood, cost in budget')
  } else {
    console.log('🔴 GUARDIAN TRIPPED:')
    for (const t of v.tripped) console.log('   - ' + t)
  }
  console.log('════════════════════════════════════\n')
  process.exit(v.ok ? 0 : 1)
}

main()
