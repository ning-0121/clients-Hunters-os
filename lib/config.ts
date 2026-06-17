/**
 * App-wide config (singleton row in app_config). Drives auto-discovery.
 * Gracefully returns defaults if the table/row is missing (migration 006 not yet
 * applied) — so nothing auto-runs until it's explicitly enabled in settings.
 */
import { createDirectClient } from '@/lib/supabase/server'

export type DiscoverySegment = 'overseas' | 'domestic' | 'recruitment'

/** What we primarily sell — drives report + outreach framing. */
export type SalesFocus = 'activewear' | 'activewear_first' | 'software'

/** Per-salesperson assignment quota by tier. */
export interface AssignQuota { A: number; B: number; C: number }

/** Seller/company profile captured at onboarding — shapes every outreach email. */
export interface SellerProfile {
  companyIntro: string        // one-line who-we-are
  sellingPoints: string[]     // core differentiators we may cite
  targetPreferences: string   // free text: regions / categories / customer types to focus
  outreachTone: 'professional' | 'warm' | 'concise'
  defaultLang: 'auto' | 'en' | 'es' | 'pt' | 'zh'
  mentionMoq: boolean
  mentionPrice: boolean
  signature: string
  ctaPreference: string       // preferred call-to-action
}

export const DEFAULT_SELLER_PROFILE: SellerProfile = {
  companyIntro: '我们是 QIMO / Jojofashion，中国运动服 OEM/ODM 工厂（瑜伽服、无缝、leggings、运动内衣、卫衣套装）。',
  sellingPoints: ['低起订量（50件/款起）', '自有设计打版', '30-45 天返单'],
  targetPreferences: '',
  outreachTone: 'professional',
  defaultLang: 'auto',
  mentionMoq: true,
  mentionPrice: false,
  signature: 'Alex / Jojofashion / jojofashion.us',
  ctaPreference: '约 15 分钟电话，或先发一份产品目录',
}

export const OUTREACH_TONE_LABELS: Record<SellerProfile['outreachTone'], string> = {
  professional: '专业稳重',
  warm: '热情口语',
  concise: '简洁直接',
}

export interface AppConfig {
  autoDiscoveryEnabled: boolean
  dailyQuota: number
  segments: DiscoverySegment[]
  salesFocus: SalesFocus
  /** Roster of salesperson identities (email or name used in companies.assigned_to). */
  salespeople: string[]
  /** How many of each tier each salesperson should hold. */
  assignQuota: AssignQuota
  /** Whether first-login onboarding has been completed. */
  onboardingCompleted: boolean
  /** Seller/company profile that shapes outreach. */
  sellerProfile: SellerProfile
}

export const DEFAULT_ASSIGN_QUOTA: AssignQuota = { A: 5, B: 10, C: 15 }

export const DEFAULT_CONFIG: AppConfig = {
  autoDiscoveryEnabled: false,
  dailyQuota: 20,
  segments: ['overseas', 'domestic', 'recruitment'],
  salesFocus: 'activewear',   // QIMO default: sell activewear, do NOT pitch software
  salespeople: [],
  assignQuota: DEFAULT_ASSIGN_QUOTA,
  onboardingCompleted: false,
  sellerProfile: DEFAULT_SELLER_PROFILE,
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
    const people = Array.isArray(data.salespeople)
      ? (data.salespeople as unknown[]).map(String).map((s) => s.trim()).filter(Boolean)
      : DEFAULT_CONFIG.salespeople
    const q = (data.assign_quota ?? {}) as Partial<AssignQuota>
    return {
      autoDiscoveryEnabled: !!data.auto_discovery_enabled,
      dailyQuota: typeof data.daily_quota === 'number' ? data.daily_quota : 20,
      segments: segments.length ? segments : DEFAULT_CONFIG.segments,
      salesFocus: (sf === 'activewear' || sf === 'activewear_first' || sf === 'software') ? sf : DEFAULT_CONFIG.salesFocus,
      salespeople: people,
      assignQuota: {
        A: typeof q.A === 'number' ? q.A : DEFAULT_ASSIGN_QUOTA.A,
        B: typeof q.B === 'number' ? q.B : DEFAULT_ASSIGN_QUOTA.B,
        C: typeof q.C === 'number' ? q.C : DEFAULT_ASSIGN_QUOTA.C,
      },
      onboardingCompleted: !!data.onboarding_completed,
      sellerProfile: { ...DEFAULT_SELLER_PROFILE, ...((data.seller_profile as Partial<SellerProfile> | null) ?? {}) },
    }
  } catch {
    return DEFAULT_CONFIG
  }
}
