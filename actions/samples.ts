'use server'

import { createServiceClient } from '@/lib/supabase/server'
import { enqueueHandoff } from '@/lib/metronome/client'
import { buildSamplePayload } from '@/lib/metronome/payloads'
import { logEvent } from '@/lib/events/log'
import { revalidatePath } from 'next/cache'

/**
 * Create a sample request from a conversation/company.
 * This is the conversion mechanism for a manufacturer — track it tightly.
 */
export async function createSample(formData: FormData): Promise<void> {
  const companyId = formData.get('companyId') as string
  if (!companyId) return
  const sb = await createServiceClient()

  const styles = (formData.get('styles') as string ?? '')
    .split(',').map(s => s.trim()).filter(Boolean)

  const { data: sample } = await sb.from('samples').insert({
    company_id:       companyId,
    contact_id:       (formData.get('contactId') as string) || null,
    conversation_id:  (formData.get('conversationId') as string) || null,
    styles_requested: styles.length ? styles : null,
    quantity:         formData.get('quantity') ? Number(formData.get('quantity')) : null,
    spec_notes:       (formData.get('specNotes') as string) || null,
    shipping_name:    (formData.get('shippingName') as string) || null,
    shipping_address: (formData.get('shippingAddress') as string) || null,
    shipping_country: (formData.get('shippingCountry') as string) || null,
    shipping_phone:   (formData.get('shippingPhone') as string) || null,
    status:           'requested',
    deal_id:          (formData.get('dealId') as string) || null,
  }).select('id').single()

  // Move company into the sampling stage
  await sb.from('companies').update({
    status: 'qualified', last_activity_at: new Date().toISOString(),
  }).eq('id', companyId)

  // Create a follow-up task: confirm + ship
  await sb.from('tasks').insert({
    company_id: companyId,
    sample_id:  sample?.id ?? null,
    task_type:  'sample_followup',
    priority:   2,
    title:      '📦 Confirm sample details & arrange shipping',
    detail:     `Styles: ${styles.join(', ') || 'TBD'}. Confirm cost-bearer, then push to production (节拍器).`,
    status:     'open',
    source:     'system',
    due_at:     new Date().toISOString(),
  }).select('id')

  await logEvent({
    companyId, dealId: (formData.get('dealId') as string) || null,
    eventType: 'sample', direction: 'out',
    title: `寄样请求${styles.length ? '：' + styles.join('、') : ''}`,
    refTable: 'samples', refId: sample?.id ?? null,
  })

  revalidatePath(`/companies/${companyId}`)
  revalidatePath('/samples')
  revalidatePath('/tasks')
}

/** Advance a sample's lifecycle status. */
export async function updateSampleStatus(formData: FormData): Promise<void> {
  const sampleId = formData.get('sampleId') as string
  const status   = formData.get('status') as string
  if (!sampleId || !status) return
  const sb = await createServiceClient()

  const update: Record<string, unknown> = { status, updated_at: new Date().toISOString() }
  const now = new Date().toISOString()
  if (status === 'confirmed')  update.confirmed_at = now
  // On confirmation, hand the sample off to the production system (节拍器)
  if (status === 'confirmed') {
    const { data: s } = await sb.from('samples').select('company_id, pushed_to_metronome').eq('id', sampleId).single()
    if (s?.company_id && !s.pushed_to_metronome) {
      const payload = await buildSamplePayload(sampleId)
      if (payload) await enqueueHandoff({ entityType: 'sample', entityId: sampleId, companyId: s.company_id, payload })
    }
  }
  if (status === 'shipped') {
    update.shipped_at      = now
    update.tracking_number = (formData.get('trackingNumber') as string) || null
    update.carrier         = (formData.get('carrier') as string) || null
  }
  if (status === 'delivered') update.delivered_at = now
  if (status === 'feedback_received' || status === 'approved' || status === 'rejected') {
    update.feedback    = (formData.get('feedback') as string) || null
    update.feedback_at = now
  }

  await sb.from('samples').update(update).eq('id', sampleId)

  // When shipped, auto-create a feedback-chase task 10 days out
  if (status === 'shipped') {
    const { data: s } = await sb.from('samples').select('company_id, contact_id').eq('id', sampleId).single()
    if (s?.company_id) {
      await sb.from('tasks').insert({
        company_id: s.company_id,
        contact_id: s.contact_id,
        sample_id:  sampleId,
        task_type:  'sample_followup',
        priority:   2,
        title:      '📬 Chase sample feedback',
        detail:     'Sample shipped 10 days ago — ask what they thought and push toward first order.',
        status:     'open',
        source:     'system',
        due_at:     new Date(Date.now() + 10 * 86_400_000).toISOString(),
      })
    }
  }

  revalidatePath('/samples')
  revalidatePath('/tasks')
}
