'use server'

import { createServiceClient } from '@/lib/supabase/server'
import { runDailyAssignment } from '@/lib/assignment/assign'
import { revalidatePath } from 'next/cache'

/** Save the salesperson roster + per-tier quota (manager / settings). */
export async function saveTeamConfig(formData: FormData): Promise<void> {
  const peopleRaw = String(formData.get('salespeople') ?? '')
  const salespeople = peopleRaw
    .split(/[\n,]+/).map((s) => s.trim()).filter(Boolean)
  const A = Math.max(0, Math.min(100, Math.round(Number(formData.get('quotaA') ?? 5)) || 0))
  const B = Math.max(0, Math.min(200, Math.round(Number(formData.get('quotaB') ?? 10)) || 0))
  const C = Math.max(0, Math.min(300, Math.round(Number(formData.get('quotaC') ?? 15)) || 0))
  try {
    const sb = await createServiceClient()
    await sb.from('app_config').upsert({
      id: 'singleton',
      salespeople,
      assign_quota: { A, B, C },
      updated_at: new Date().toISOString(),
    }, { onConflict: 'id' })
  } catch (err) {
    console.error('[saveTeamConfig]', err)
  }
  revalidatePath('/settings')
  revalidatePath('/manager/bd-dashboard')
}

/** Run the daily top-up assignment (manager action). */
export async function triggerDailyAssignment(): Promise<void> {
  try {
    await runDailyAssignment(new Date().toISOString())
  } catch (err) {
    console.error('[triggerDailyAssignment]', err)
  }
  revalidatePath('/manager/bd-dashboard')
  revalidatePath('/bd/today')
  revalidatePath('/bd/leads')
}
