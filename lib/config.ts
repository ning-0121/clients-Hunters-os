/**
 * App-wide config (singleton row in app_config). Drives auto-discovery.
 * Gracefully returns defaults if the table/row is missing (migration 006 not yet
 * applied) — so nothing auto-runs until it's explicitly enabled in settings.
 */
import { createDirectClient } from '@/lib/supabase/server'

export type DiscoverySegment = 'overseas' | 'domestic' | 'recruitment'

export interface AppConfig {
  autoDiscoveryEnabled: boolean
  dailyQuota: number
  segments: DiscoverySegment[]
}

export const DEFAULT_CONFIG: AppConfig = {
  autoDiscoveryEnabled: false,
  dailyQuota: 20,
  segments: ['overseas', 'domestic', 'recruitment'],
}

export const SEGMENT_LABELS: Record<DiscoverySegment, string> = {
  overseas: '海外运动服品牌/进口商',
  domestic: '国内服装外贸公司',
  recruitment: '招聘信号线索',
}

/** Map a segment to DiscoveryAgent params. */
export function segmentToDiscoveryParams(seg: DiscoverySegment, maxLeads: number): Record<string, unknown> {
  if (seg === 'domestic') return { searchMode: 'targeted', targetType: 'domestic_trade', maxLeads }
  if (seg === 'recruitment') return { searchMode: 'targeted', targetType: 'recruitment', maxLeads }
  return { searchMode: 'targeted', maxLeads } // overseas mix
}

export async function getAppConfig(): Promise<AppConfig> {
  try {
    const sb = createDirectClient()
    const { data, error } = await sb.from('app_config').select('*').eq('id', 'singleton').maybeSingle()
    if (error || !data) return DEFAULT_CONFIG
    const segments = Array.isArray(data.segments) ? (data.segments as DiscoverySegment[]) : DEFAULT_CONFIG.segments
    return {
      autoDiscoveryEnabled: !!data.auto_discovery_enabled,
      dailyQuota: typeof data.daily_quota === 'number' ? data.daily_quota : 20,
      segments: segments.length ? segments : DEFAULT_CONFIG.segments,
    }
  } catch {
    return DEFAULT_CONFIG
  }
}
