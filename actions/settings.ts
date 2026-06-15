'use server'

import { createServiceClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

/** Save the auto-discovery settings (enabled / daily quota / segments). */
export async function saveAutoDiscoveryConfig(formData: FormData): Promise<void> {
  const enabled = formData.get('enabled') === 'on'
  const quota = Math.max(1, Math.min(200, Math.round(Number(formData.get('quota') ?? 20)) || 20))
  const segments = formData.getAll('segments').map(String).filter(Boolean)

  try {
    const sb = await createServiceClient()
    await sb.from('app_config').upsert({
      id: 'singleton',
      auto_discovery_enabled: enabled,
      daily_quota: quota,
      segments: segments.length ? segments : ['overseas'],
      updated_at: new Date().toISOString(),
    }, { onConflict: 'id' })
  } catch (err) {
    console.error('[saveAutoDiscoveryConfig]', err)
  }
  revalidatePath('/settings')
}
