'use server'

import { createServiceClient } from '@/lib/supabase/server'
import { enqueueHandoff } from '@/lib/metronome/client'
import { buildOrderPayload } from '@/lib/metronome/payloads'
import { revalidatePath } from 'next/cache'

/** Create a draft order from a company (typically after sample approval). */
export async function createOrder(formData: FormData): Promise<void> {
  const companyId = formData.get('companyId') as string
  if (!companyId) return
  const sb = await createServiceClient()

  // Parse product lines if provided as simple "style:qty:price" lines
  const rawLines = (formData.get('productLines') as string ?? '').trim()
  const productLines = rawLines
    ? rawLines.split('\n').map(line => {
        const [style, qty, price] = line.split(':').map(s => s.trim())
        return { style, qty: qty ? Number(qty) : null, unit_price: price ? Number(price) : null }
      }).filter(l => l.style)
    : null

  await sb.from('orders').insert({
    company_id:        companyId,
    contact_id:        (formData.get('contactId') as string) || null,
    sample_id:         (formData.get('sampleId') as string) || null,
    order_ref:         (formData.get('orderRef') as string) || null,
    order_value_usd:   formData.get('orderValue') ? Number(formData.get('orderValue')) : null,
    product_lines:     productLines,
    moq_agreed:        formData.get('moq') ? Number(formData.get('moq')) : null,
    payment_terms:     (formData.get('paymentTerms') as string) || null,
    required_delivery: (formData.get('requiredDelivery') as string) || null,
    destination_port:  (formData.get('destinationPort') as string) || null,
    shipping_method:   (formData.get('shippingMethod') as string) || null,
    brand_requirements:(formData.get('brandRequirements') as string) || null,
    status:            'draft',
  })

  revalidatePath(`/companies/${companyId}`)
  revalidatePath('/orders')
}

/** Confirm an order → mark company closed_won + hand off to production (节拍器). */
export async function confirmOrder(formData: FormData): Promise<void> {
  const orderId = formData.get('orderId') as string
  if (!orderId) return
  const sb = await createServiceClient()

  const { data: order } = await sb.from('orders')
    .select('company_id, pushed_to_metronome').eq('id', orderId).single()
  if (!order) return

  await sb.from('orders').update({
    status: 'confirmed', updated_at: new Date().toISOString(),
  }).eq('id', orderId)

  // Move company to closed_won
  if (order.company_id) {
    await sb.from('companies').update({
      status: 'closed_won', last_activity_at: new Date().toISOString(),
    }).eq('id', order.company_id)
  }

  // Hand off to production system
  if (order.company_id && !order.pushed_to_metronome) {
    const payload = await buildOrderPayload(orderId)
    if (payload) await enqueueHandoff({ entityType: 'order', entityId: orderId, companyId: order.company_id, payload })
  }

  revalidatePath('/orders')
  if (order.company_id) revalidatePath(`/companies/${order.company_id}`)
}
