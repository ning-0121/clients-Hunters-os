'use server'

import { createServiceClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

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

/** Re-open onboarding to edit the company / outreach profile. */
export async function reopenOnboarding(): Promise<void> {
  try {
    const sb = await createServiceClient()
    await sb.from('app_config').upsert({ id: 'singleton', onboarding_completed: false, updated_at: new Date().toISOString() }, { onConflict: 'id' })
  } catch (err) {
    console.error('[reopenOnboarding]', err)
  }
  revalidatePath('/', 'layout')
  redirect('/bd/today')
}

/** Save the seller/company profile from onboarding (and mark it complete). */
export async function saveSellerProfile(formData: FormData): Promise<void> {
  const str = (k: string, fallback = '') => String(formData.get(k) ?? fallback).trim()
  const tone = str('outreachTone', 'professional')
  const lang = str('defaultLang', 'auto')
  const sellerProfile = {
    companyIntro: str('companyIntro'),
    sellingPoints: str('sellingPoints').split(/[\n;；]+/).map((s) => s.trim()).filter(Boolean),
    targetPreferences: str('targetPreferences'),
    outreachTone: (['professional', 'warm', 'concise'].includes(tone) ? tone : 'professional') as 'professional' | 'warm' | 'concise',
    defaultLang: (['auto', 'en', 'es', 'pt', 'zh'].includes(lang) ? lang : 'auto') as 'auto' | 'en' | 'es' | 'pt' | 'zh',
    mentionMoq: formData.get('mentionMoq') === 'on',
    mentionPrice: formData.get('mentionPrice') === 'on',
    signature: str('signature'),
    ctaPreference: str('ctaPreference'),
  }
  const salesFocusRaw = str('salesFocus', 'activewear')
  const salesFocus = (['activewear', 'activewear_first', 'software'].includes(salesFocusRaw) ? salesFocusRaw : 'activewear')
  try {
    const sb = await createServiceClient()
    await sb.from('app_config').upsert({
      id: 'singleton',
      seller_profile: sellerProfile,
      sales_focus: salesFocus,
      onboarding_completed: true,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'id' })
  } catch (err) {
    console.error('[saveSellerProfile]', err)
  }
  revalidatePath('/', 'layout')
  revalidatePath('/settings')
}

/** Save the primary sales focus (activewear / activewear_first / software). */
export async function saveSalesFocus(formData: FormData): Promise<void> {
  const raw = String(formData.get('salesFocus') ?? 'activewear')
  const salesFocus = (raw === 'activewear' || raw === 'activewear_first' || raw === 'software') ? raw : 'activewear'
  try {
    const sb = await createServiceClient()
    await sb.from('app_config').upsert({
      id: 'singleton',
      sales_focus: salesFocus,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'id' })
  } catch (err) {
    console.error('[saveSalesFocus]', err)
  }
  revalidatePath('/settings')
}
