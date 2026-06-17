'use server'

import { createDirectClient, createServiceClient } from '@/lib/supabase/server'
import { getAppConfig } from '@/lib/config'
import { getBdIdentity } from '@/lib/bd/shared'
import { revalidatePath } from 'next/cache'

/**
 * Admin: create an employee account so they can log in themselves. Also adds
 * them to the salesperson roster so they can be assigned customers.
 */
export async function createEmployee(formData: FormData): Promise<void> {
  const email = String(formData.get('email') ?? '').trim().toLowerCase()
  const name = String(formData.get('name') ?? '').trim()
  const password = String(formData.get('password') ?? '')
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || password.length < 8) {
    revalidatePath('/settings'); return
  }
  try {
    const admin = createDirectClient()
    const { error } = await admin.auth.admin.createUser({
      email, password, email_confirm: true,
      user_metadata: { role: 'salesperson', name: name || email.split('@')[0] },
    })
    if (error && !/already|registered|exists/i.test(error.message)) {
      console.error('[createEmployee]', error.message)
    }
    // Add to the salesperson roster (dedup).
    const cfg = await getAppConfig()
    if (!cfg.salespeople.includes(email)) {
      const sb = await createServiceClient()
      await sb.from('app_config').upsert(
        { id: 'singleton', salespeople: [...cfg.salespeople, email], updated_at: new Date().toISOString() },
        { onConflict: 'id' },
      )
    }
  } catch (err) {
    console.error('[createEmployee]', err)
  }
  revalidatePath('/settings')
  revalidatePath('/manager/bd-dashboard')
}

/**
 * The logged-in employee binds their OWN sending mailbox (so outreach goes out
 * from them). SMTP host blank → treated as a Gmail app password.
 */
export async function saveMyEmailSettings(formData: FormData): Promise<void> {
  const { who } = await getBdIdentity()
  if (!who || who === 'me') { revalidatePath('/settings'); return }
  const senderEmail = String(formData.get('senderEmail') ?? '').trim()
  const appPassword = String(formData.get('appPassword') ?? '').trim()
  const fromName = String(formData.get('fromName') ?? '').trim()
  const smtpHost = String(formData.get('smtpHost') ?? '').trim() || null
  const smtpPort = Math.round(Number(formData.get('smtpPort') ?? 465)) || 465
  const active = formData.get('active') === 'on'
  if (!senderEmail) { revalidatePath('/settings'); return }
  try {
    const sb = await createServiceClient()
    const row: Record<string, unknown> = {
      owner: who, sender_email: senderEmail, from_name: fromName || null,
      smtp_host: smtpHost, smtp_port: smtpPort, active, updated_at: new Date().toISOString(),
    }
    // Only overwrite the password when a new one is supplied (so re-saving other fields keeps it).
    if (appPassword) row.app_password = appPassword
    if (appPassword) {
      await sb.from('user_email_settings').upsert(row, { onConflict: 'owner' })
    } else {
      // update without touching app_password
      const { data: existing } = await sb.from('user_email_settings').select('owner').eq('owner', who).maybeSingle()
      if (existing) await sb.from('user_email_settings').update(row).eq('owner', who)
      // if no existing row and no password, can't create (password required) — skip
    }
  } catch (err) {
    console.error('[saveMyEmailSettings]', err)
  }
  revalidatePath('/settings')
}
