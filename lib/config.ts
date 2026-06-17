/**
 * App-wide config (singleton row in app_config). Drives auto-discovery.
 * Gracefully returns defaults if the table/row is missing (migration 006 not yet
 * applied) — so nothing auto-runs until it's explicitly enabled in settings.
 */
import { createDirectClient } from '@/lib/supabase/server'

export type DiscoverySegment = 'overseas' | 'domestic' | 'recruitment'

/** What we primarily sell — drives report + outreach framing. */
export type SalesFocus = 'activewear' | 'activewear_first' | 'software'

export interface AppConfig {
  autoDiscoveryEnabled: boolean
  dailyQuota: number
  segments: DiscoverySegment[]
  salesFocus: SalesFocus
}

export const DEFAULT_CONFIG: AppConfig = {
  autoDiscoveryEnabled: false,
  dailyQuota: 20,
  segments: ['overseas', 'domestic', 'recruitment'],
  salesFocus: 'activewear',   // QIMO default: sell activewear, do NOT pitch software
}

export const SALES_FOCUS_LABELS: Record<SalesFocus, string> = {
  activewear: '只卖运动服 OEM/ODM',
  activewear_first: '运动服为主，软件为辅',
  software: '只卖软件（ARAOS/Order Metronome）',
}

/** A one-line directive injected into report/outreach prompts. */
export function salesFocusDirective(f: SalesFocus): string {
  if (f === 'software') return '我方主推：外贸客户开发/订单管理软件（ARAOS / Order Metronome）。把客户当软件潜在客户，不要推服装订单。'
  if (f === 'activewear_first') return '我方主推：运动服 OEM/ODM 订单（运动服/瑜伽服/无缝/leggings 等）；软件为次要。优先谈服装订单合作。'
  return '我方主推：运动服 OEM/ODM 订单（运动服/瑜伽服/无缝/leggings/运动内衣/卫衣套装等）。**绝对不要推销任何软件**——即使对方是国内外贸公司，也把它当作"可能向我们下服装订单/做服装渠道"的客户来谈。'
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
    const sf = data.sales_focus
    return {
      autoDiscoveryEnabled: !!data.auto_discovery_enabled,
      dailyQuota: typeof data.daily_quota === 'number' ? data.daily_quota : 20,
      segments: segments.length ? segments : DEFAULT_CONFIG.segments,
      salesFocus: (sf === 'activewear' || sf === 'activewear_first' || sf === 'software') ? sf : DEFAULT_CONFIG.salesFocus,
    }
  } catch {
    return DEFAULT_CONFIG
  }
}
