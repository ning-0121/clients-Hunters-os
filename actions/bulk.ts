'use server'

import { createDirectClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

export async function bulkQueueAction() {
  const supabase = createDirectClient()

  const { data: rawCompanies } = await supabase
    .from('companies')
    .select('id')
    .eq('status', 'raw')

  if (!rawCompanies?.length) {
    revalidatePath('/companies')
    return
  }

  const jobs = rawCompanies.map((c) => ({
    job_type: 'enrich_company',
    payload: { companyId: c.id },
    priority: 4,
  }))

  await supabase.from('agent_queue').insert(jobs)

  revalidatePath('/companies')
}
