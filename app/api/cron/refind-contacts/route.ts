/**
 * Periodic contact re-finder (continuous hunting).
 *
 * Companies parked at status='awaiting_contact' (good fit, but no verified email /
 * usable phone) are re-enriched on a schedule so the discovery waterfall keeps
 * trying to find a reachable decision-maker. Each pass ESCALATES: it rotates the
 * role focus by attempt count (sourcing/production → merch/buyer → ops/supply →
 * founder/CEO) so we don't keep running the identical search. When enrichment
 * lands a verified contact, the normal score → tier flow un-parks the company.
 *
 * Auth: same Bearer ${CRON_SECRET} convention as the other crons.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { createDirectClient } from '@/lib/supabase/server'
import { companyHuntDue } from '@/lib/contacts/hunt-cadence'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const BATCH = 15

/** Role focus per hunt attempt — rotate the title search so each pass tries new angles. */
const HUNT_PHASES: string[][] = [
  ['VP Sourcing', 'Director of Sourcing', 'Head of Sourcing', 'Sourcing Manager', 'Director of Production', 'Production Manager'],
  ['Merchandising Director', 'Merchandising Manager', 'Product Development Manager', 'Apparel Buyer', 'Purchasing Manager'],
  ['Operations Manager', 'Supply Chain Manager', 'Head of Product', 'Category Manager'],
  ['Founder', 'CEO', 'Owner', 'President'],
]
function huntPhase(attempts: number): string[] {
  return HUNT_PHASES[Math.min(Math.max(attempts, 0), HUNT_PHASES.length - 1)]
}

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return true // not configured — allow (dev)
  return req.headers.get('authorization') === `Bearer ${secret}`
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const sb = createDirectClient()

  // Oldest-touched parked companies first.
  const { data: parked } = await sb
    .from('companies')
    .select('id, source_raw, customer_tier')
    .eq('status', 'awaiting_contact')
    .order('updated_at', { ascending: true })
    .limit(BATCH)
  const rows = parked ?? []
  if (!rows.length) return NextResponse.json({ ok: true, parked: 0, queued: 0 })

  // Don't double-queue: skip companies that already have a pending enrich job.
  const { data: pendingJobs } = await sb
    .from('agent_queue')
    .select('payload')
    .eq('job_type', 'enrich_company')
    .in('status', ['waiting', 'active'])
  const pendingIds = new Set(
    (pendingJobs ?? []).map((j) => (j.payload as { companyId?: string } | null)?.companyId).filter(Boolean),
  )
  const toProcess = rows.filter((r) => !pendingIds.has(r.id as string))

  const nowMs = Date.now()
  const nowIso = new Date(nowMs).toISOString()
  let queued = 0
  let skipped = 0
  for (const r of toProcess) {
    const companyId = r.id as string
    const raw = (r.source_raw as Record<string, unknown>) ?? {}

    // Cooldown gate: high-value (A/B) re-hunts every 12h, others every 72h — never
    // a tight loop. Not-due companies just rotate to the back (no API call).
    if (!companyHuntDue({ tier: r.customer_tier as string | null, sourceRaw: raw, nowMs })) {
      await sb.from('companies').update({ updated_at: nowIso }).eq('id', companyId)
      skipped++
      continue
    }

    const hunt = (raw.hunt as { attempts?: number } | undefined) ?? {}
    const attempts = typeof hunt.attempts === 'number' ? hunt.attempts : 0
    const roleTarget = huntPhase(attempts)

    // Enqueue the discovery waterfall with this attempt's role focus.
    await sb.from('agent_queue').insert({
      job_type: 'enrich_company',
      payload: { companyId, roleTarget, reason: 'refind_contacts', huntAttempt: attempts },
      priority: 5,
    })
    // Record the attempt + rotate to the back of the queue for next time.
    await sb
      .from('companies')
      .update({
        source_raw: { ...raw, hunt: { attempts: attempts + 1, last_hunt_at: nowIso, last_phase: roleTarget } },
        updated_at: nowIso,
      })
      .eq('id', companyId)
    queued++
  }

  return NextResponse.json({ ok: true, parked: rows.length, queued, skipped })
}
