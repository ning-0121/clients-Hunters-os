'use server'

import { createServiceClient } from '@/lib/supabase/server'
import { resolveSendableEmail } from '@/lib/email/resolve'
import { revalidatePath } from 'next/cache'

/**
 * Verify (and where possible find/repair) the emails of a company's contacts.
 * Runs the find→verify→decide waterfall and persists email_verified /
 * email_deliverable on each contact, so the UI can show a trustworthy status.
 */
export async function verifyContactEmails(formData: FormData): Promise<void> {
  const companyId = String(formData.get('companyId') ?? '')
  if (!companyId) return
  try {
    const sb = await createServiceClient()
    const [{ data: company }, { data: contacts }] = await Promise.all([
      sb.from('companies').select('website').eq('id', companyId).single(),
      sb.from('contacts').select('id, full_name, first_name, last_name, email, email_source, email_confidence')
        .eq('company_id', companyId).order('contact_priority', { ascending: false }).limit(8),
    ])
    for (const c of contacts ?? []) {
      await resolveSendableEmail({
        contactId: c.id,
        email: c.email,
        source: c.email_source,
        confidence: c.email_confidence,
        firstName: c.first_name,
        lastName: c.last_name,
        fullName: c.full_name,
        website: company?.website,
      })
    }
  } catch (err) {
    console.error('[verifyContactEmails]', err)
  }
  revalidatePath(`/companies/${companyId}`)
}
