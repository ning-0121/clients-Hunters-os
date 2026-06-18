/**
 * Periodic contact re-finder.
 *
 * Companies parked at status='awaiting_contact' (good fit, but no verified email /
 * usable phone) are re-enriched on a schedule so AI keeps trying to find a real
 * contact. When enrichment lands a reachable contact, the normal score → tier
 * flow un-parks them; if not, they get re-parked and rotate to the back.
 *
 * Auth: same Bearer ${CRON_SECRET} convention as the other crons.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { createDirectClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const BATCH = 15

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
    .select('id')
    .eq('status', 'awaiting_contact')
    .order('updated_at', { ascending: true })
    .limit(BATCH)
  const ids = (parked ?? []).map((c) => c.id as string)
  if (!ids.length) return NextResponse.json({ ok: true, parked: 0, queued: 0 })

  // Don't double-queue: skip companies that already have a pending enrich job.
  const { data: pendingJobs } = await sb
    .from('agent_queue')
    .select('payload')
    .eq('job_type', 'enrich_company')
    .in('status', ['waiting', 'active'])
  const pendingIds = new Set(
    (pendingJobs ?? []).map((j) => (j.payload as { companyId?: string } | null)?.companyId).filter(Boolean),
  )
  const toQueue = ids.filter((id) => !pendingIds.has(id))

  if (toQueue.length) {
    await sb.from('agent_queue').insert(
      toQueue.map((companyId) => ({
        job_type: 'enrich_company',
        payload: { companyId, reason: 'refind_contacts' },
        priority: 5,
      })),
    )
    // Rotate them to the back of the queue for next time.
    await sb.from('companies').update({ updated_at: new Date().toISOString() }).in('id', toQueue)
  }

  return NextResponse.json({ ok: true, parked: ids.length, queued: toQueue.length })
}
