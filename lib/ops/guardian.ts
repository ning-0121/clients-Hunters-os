/**
 * Ops Guardians — runaway protection for the agent/draft pipeline.
 *
 * Born from the P0 follow-up loop (195k duplicate drafts, ~$570/day burn). The
 * trigger was a self-enqueuing agent with no circuit-breaker. These guardians
 * give every draft/enqueue path a cheap hard stop, and power the health readout.
 *
 *   Queue Guardian  — agent_queue backlog must not explode.
 *   Draft Guardian  — pending_approval drafts must not pile up (dedup failure tell).
 *   Cost Guardian   — AI drafts/day (≈ LLM spend) must stay under budget.
 */
import { createDirectClient } from '@/lib/supabase/server'

type DirectClient = ReturnType<typeof createDirectClient>

export const GUARDIAN = {
  maxAgentQueue:     5_000,   // backlog ceiling
  maxPendingDrafts:  1_000,   // pending_approval ceiling (would have capped the P0 at 1k)
  maxAiDraftsPerDay: 2_000,   // daily AI-draft cap
  costPerDraftUSD:   0.008,   // ~Sonnet, 600 in / 400 out tokens
}

export interface HealthMetrics {
  agentQueueSize: number
  waitingActive: number
  pendingDrafts: number
  jobsLastHour: number
  aiDraftsLast24h: number
  estCostLast24hUSD: number
}

async function n(p: PromiseLike<{ count: number | null }>): Promise<number> {
  return (await p).count ?? 0
}

export async function systemHealth(sb: DirectClient): Promise<HealthMetrics> {
  const hourAgo = new Date(Date.now() - 3_600_000).toISOString()
  const dayAgo = new Date(Date.now() - 86_400_000).toISOString()
  const [agentQueueSize, waitingActive, pendingDrafts, jobsLastHour, aiDraftsLast24h] = await Promise.all([
    n(sb.from('agent_queue').select('id', { count: 'exact', head: true })),
    n(sb.from('agent_queue').select('id', { count: 'exact', head: true }).in('status', ['waiting', 'active'])),
    n(sb.from('outreach_logs').select('id', { count: 'exact', head: true }).eq('status', 'pending_approval')),
    n(sb.from('agent_queue').select('id', { count: 'exact', head: true }).gte('created_at', hourAgo)),
    n(sb.from('outreach_logs').select('id', { count: 'exact', head: true }).gte('created_at', dayAgo).eq('executed_by', 'ai')),
  ])
  return {
    agentQueueSize, waitingActive, pendingDrafts, jobsLastHour, aiDraftsLast24h,
    estCostLast24hUSD: Math.round(aiDraftsLast24h * GUARDIAN.costPerDraftUSD * 100) / 100,
  }
}

export interface GuardianVerdict { ok: boolean; tripped: string[]; metrics: HealthMetrics }

export async function checkGuardians(sb: DirectClient): Promise<GuardianVerdict> {
  const m = await systemHealth(sb)
  const tripped: string[] = []
  if (m.agentQueueSize > GUARDIAN.maxAgentQueue) tripped.push(`Queue Guardian: agent_queue ${m.agentQueueSize} > ${GUARDIAN.maxAgentQueue}`)
  if (m.pendingDrafts > GUARDIAN.maxPendingDrafts) tripped.push(`Draft Guardian: pending_approval ${m.pendingDrafts} > ${GUARDIAN.maxPendingDrafts}`)
  if (m.aiDraftsLast24h > GUARDIAN.maxAiDraftsPerDay) tripped.push(`Cost Guardian: AI drafts/24h ${m.aiDraftsLast24h} > ${GUARDIAN.maxAiDraftsPerDay} (~$${m.estCostLast24hUSD})`)
  return { ok: tripped.length === 0, tripped, metrics: m }
}

/**
 * Cheap runtime circuit-breaker for any draft-creating / self-enqueuing path.
 * Call before generating drafts; if it returns ok:false, HALT — a runaway is
 * underway and continuing only burns credits.
 */
export async function draftQueueHealthy(sb: DirectClient): Promise<{ ok: boolean; reason?: string }> {
  const pending = await n(sb.from('outreach_logs').select('id', { count: 'exact', head: true }).eq('status', 'pending_approval'))
  if (pending > GUARDIAN.maxPendingDrafts) return { ok: false, reason: `pending_approval ${pending} > ${GUARDIAN.maxPendingDrafts} (Draft Guardian)` }
  const queue = await n(sb.from('agent_queue').select('id', { count: 'exact', head: true }).in('status', ['waiting', 'active']))
  if (queue > GUARDIAN.maxAgentQueue) return { ok: false, reason: `agent_queue ${queue} > ${GUARDIAN.maxAgentQueue} (Queue Guardian)` }
  return { ok: true }
}
