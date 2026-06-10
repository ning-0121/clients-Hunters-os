/**
 * 节拍器 (Metronome) Production System Integration
 *
 * ARAOS hands off confirmed samples and orders to the production system.
 * Transport is a configurable webhook so the production team only needs to
 * expose one receiving endpoint.
 *
 * .env.local:
 *   METRONOME_WEBHOOK_URL=https://metronome.example.com/api/intake
 *   METRONOME_API_KEY=shared_secret
 *
 * If unset, handoffs are recorded as 'pending' but not pushed (safe no-op),
 * so the system works end-to-end before the production API is ready.
 */

import { createDirectClient } from '@/lib/supabase/server'

export type HandoffEntity = 'sample' | 'order'

export interface HandoffResult {
  ok: boolean
  metronomeRef?: string
  error?: string
  skipped?: boolean
}

export function isMetronomeConfigured(): boolean {
  return !!process.env.METRONOME_WEBHOOK_URL
}

/**
 * Enqueue a handoff record (status='pending'). Returns the handoff row id.
 * Called from server actions when a sample/order is confirmed.
 */
export async function enqueueHandoff(params: {
  entityType: HandoffEntity
  entityId: string
  companyId: string
  payload: Record<string, unknown>
}): Promise<string | null> {
  const sb = createDirectClient()
  const { data } = await sb.from('metronome_handoffs').insert({
    entity_type: params.entityType,
    entity_id:   params.entityId,
    company_id:  params.companyId,
    payload:     params.payload,
    status:      'pending',
  }).select('id').single()
  return data?.id ?? null
}

/**
 * Push a single handoff to 节拍器. Updates the handoff row with the result.
 * Idempotent-ish: only processes rows still in 'pending'.
 */
export async function pushHandoff(handoffId: string): Promise<HandoffResult> {
  const sb = createDirectClient()
  const { data: handoff } = await sb
    .from('metronome_handoffs')
    .select('*')
    .eq('id', handoffId)
    .eq('status', 'pending')
    .single()

  if (!handoff) return { ok: false, error: 'Handoff not found or already processed' }

  // No production endpoint yet — leave as pending, do not error
  if (!isMetronomeConfigured()) {
    return { ok: false, skipped: true, error: 'METRONOME_WEBHOOK_URL not set' }
  }

  try {
    const res = await fetch(process.env.METRONOME_WEBHOOK_URL!, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(process.env.METRONOME_API_KEY ? { 'Authorization': `Bearer ${process.env.METRONOME_API_KEY}` } : {}),
      },
      body: JSON.stringify({
        source:      'araos',
        entity_type: handoff.entity_type,
        entity_id:   handoff.entity_id,
        company_id:  handoff.company_id,
        data:        handoff.payload,
        sent_at:     new Date().toISOString(),
      }),
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      const errMsg = `HTTP ${res.status}: ${text.slice(0, 200)}`
      await sb.from('metronome_handoffs').update({
        status: 'error', error_message: errMsg,
      }).eq('id', handoffId)
      return { ok: false, error: errMsg }
    }

    const body = await res.json().catch(() => ({})) as { ref?: string; id?: string }
    const metronomeRef = body.ref ?? body.id ?? null

    await sb.from('metronome_handoffs').update({
      status: 'pushed', metronome_ref: metronomeRef, pushed_at: new Date().toISOString(),
    }).eq('id', handoffId)

    // Reflect ref back on the source entity
    if (metronomeRef) {
      const table = handoff.entity_type === 'sample' ? 'samples' : 'orders'
      await sb.from(table).update({
        pushed_to_metronome: true, metronome_ref: metronomeRef,
      }).eq('id', handoff.entity_id)
    }

    return { ok: true, metronomeRef: metronomeRef ?? undefined }
  } catch (err) {
    const errMsg = String(err)
    await sb.from('metronome_handoffs').update({
      status: 'error', error_message: errMsg,
    }).eq('id', handoffId)
    return { ok: false, error: errMsg }
  }
}

/** Process all pending handoffs (called by the queue worker on each cycle). */
export async function processPendingHandoffs(limit = 10): Promise<number> {
  if (!isMetronomeConfigured()) return 0
  const sb = createDirectClient()
  const { data: pending } = await sb
    .from('metronome_handoffs')
    .select('id')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(limit)

  if (!pending?.length) return 0
  let pushed = 0
  for (const h of pending) {
    const r = await pushHandoff(h.id)
    if (r.ok) pushed++
  }
  return pushed
}
