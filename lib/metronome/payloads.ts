/**
 * Builds the data payloads handed off to 节拍器 (production system).
 * Keep these stable — the production team integrates against this shape.
 */
import { createDirectClient } from '@/lib/supabase/server'

/** Sample handoff: factory needs what to make + where to ship. */
export async function buildSamplePayload(sampleId: string): Promise<Record<string, unknown> | null> {
  const sb = createDirectClient()
  const { data: s } = await sb
    .from('samples')
    .select('*, companies(name, country), contacts(full_name, email, phone)')
    .eq('id', sampleId)
    .single()
  if (!s) return null

  const company = Array.isArray(s.companies) ? s.companies[0] : s.companies
  const contact = Array.isArray(s.contacts) ? s.contacts[0] : s.contacts

  return {
    type: 'sample_request',
    araos_sample_id:  s.id,
    company_name:     company?.name,
    contact_name:     contact?.full_name,
    contact_email:    contact?.email,
    contact_phone:    contact?.phone ?? s.shipping_phone,
    styles_requested: s.styles_requested,
    quantity:         s.quantity,
    spec_notes:       s.spec_notes,
    shipping: {
      name:    s.shipping_name,
      address: s.shipping_address,
      country: s.shipping_country ?? company?.country,
      phone:   s.shipping_phone,
    },
    cost_borne_by: s.cost_borne_by,
    araos_link:    `/companies/${s.company_id}`,
  }
}

/** Order handoff: full production-ready order spec. */
export async function buildOrderPayload(orderId: string): Promise<Record<string, unknown> | null> {
  const sb = createDirectClient()
  const { data: o } = await sb
    .from('orders')
    .select('*, companies(name, country), contacts(full_name, email)')
    .eq('id', orderId)
    .single()
  if (!o) return null

  const company = Array.isArray(o.companies) ? o.companies[0] : o.companies
  const contact = Array.isArray(o.contacts) ? o.contacts[0] : o.contacts

  return {
    type: 'production_order',
    araos_order_id:  o.id,
    order_ref:       o.order_ref,
    company_name:    company?.name,
    contact_name:    contact?.full_name,
    contact_email:   contact?.email,
    order_value_usd: o.order_value_usd,
    product_lines:   o.product_lines,
    moq_agreed:      o.moq_agreed,
    payment_terms:   o.payment_terms,
    required_delivery:  o.required_delivery,
    destination_port:   o.destination_port,
    shipping_method:    o.shipping_method,
    brand_requirements: o.brand_requirements,
    is_repeat:          o.is_repeat,
    sample_reference:   o.sample_id,
    araos_link:         `/companies/${o.company_id}`,
  }
}
