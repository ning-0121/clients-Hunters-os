/**
 * Shared helpers for the BD work-desk UI (/bd/*, /manager/*).
 * Read-only label maps + reply grouping + lightweight identity/role resolution.
 * No new backend agents — just presentation + small query helpers.
 */
import { createClient } from '@/lib/supabase/server'

export type BdRole = 'salesperson' | 'sales_manager' | 'admin'

export interface BdIdentity {
  who: string          // email / name used for assigned_to
  role: BdRole
  authenticated: boolean
}

/** Best-effort identity. App is single-tenant + service-role; auth is not enforced. */
export async function getBdIdentity(): Promise<BdIdentity> {
  try {
    const supabase = await createClient()
    const { data } = await supabase.auth.getUser()
    const user = data?.user
    if (!user) return { who: 'me', role: 'salesperson', authenticated: false }
    const meta = (user.user_metadata ?? {}) as Record<string, unknown>
    const role = (typeof meta.role === 'string' ? meta.role : 'salesperson') as BdRole
    return { who: user.email ?? user.id, role, authenticated: true }
  } catch {
    return { who: 'me', role: 'salesperson', authenticated: false }
  }
}

export const TIER_STYLES: Record<string, string> = {
  A: 'bg-purple-100 text-purple-800 border-purple-200',
  B: 'bg-blue-100 text-blue-800 border-blue-200',
  C: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  D: 'bg-gray-100 text-gray-500 border-gray-200',
}

export const SEGMENT_LABELS: Record<string, string> = {
  overseas_brand: 'Overseas brand',
  overseas_importer: 'Overseas importer',
  retailer_chain: 'Retail chain',
  offprice_buyer: 'Off-price buyer',
  domestic_trading_company: '国内外贸公司',
  domestic_factory: '国内工厂',
  domestic_ecommerce_seller: '国内电商',
  domestic_supplier: '国内供应商',
  agency_partner: '渠道伙伴',
}

export const PURPOSE_LABELS: Record<string, string> = {
  order_cooperation: '订单合作',
  software_sales: '软件销售',
  channel_partnership: '渠道合作',
  supplier_partnership: '供应商合作',
  unknown: '待定',
}

/** Priority (1 highest .. 9 lowest) → card accent color. */
export function priorityColor(priority?: number | null): string {
  const p = priority ?? 5
  if (p <= 3) return 'border-l-red-500'
  if (p <= 6) return 'border-l-amber-500'
  return 'border-l-gray-300'
}

export const TASK_TYPE_LABELS: Record<string, string> = {
  reply_needed: '客户回复待处理',
  sample_followup: '样品跟进',
  quote_followup: '报价跟进',
  meeting_prep: '会议准备',
  approval_needed: '待审批',
  dormant_reactivation: '沉睡唤醒',
  manual: '人工任务',
}

// ── Reply intent grouping ────────────────────────────────────────────────────
export type ReplyGroup =
  | 'wants_quote' | 'wants_sample' | 'wants_catalog' | 'wants_meeting'
  | 'positive' | 'not_interested' | 'unclear'

export const REPLY_GROUP_ORDER: ReplyGroup[] = [
  'wants_quote', 'wants_sample', 'wants_catalog', 'wants_meeting', 'positive', 'unclear', 'not_interested',
]

export const REPLY_GROUP_LABELS: Record<ReplyGroup, string> = {
  wants_quote: '想要报价',
  wants_sample: '想要样品',
  wants_catalog: '想要目录',
  wants_meeting: '想要会议',
  positive: '正面回复',
  not_interested: '暂不感兴趣',
  unclear: '意图不明',
}

export const REPLY_GROUP_STYLES: Record<ReplyGroup, string> = {
  wants_quote: 'bg-green-100 text-green-800',
  wants_sample: 'bg-emerald-100 text-emerald-800',
  wants_catalog: 'bg-teal-100 text-teal-800',
  wants_meeting: 'bg-blue-100 text-blue-800',
  positive: 'bg-sky-100 text-sky-800',
  not_interested: 'bg-gray-100 text-gray-500',
  unclear: 'bg-amber-100 text-amber-800',
}

export function replyGroupOf(intent?: string | null, sentiment?: string | null): ReplyGroup {
  const i = (intent ?? '').toLowerCase()
  if (i.includes('quote')) return 'wants_quote'
  if (i.includes('sample')) return 'wants_sample'
  if (i.includes('catalog')) return 'wants_catalog'
  if (i.includes('meeting')) return 'wants_meeting'
  if (i.includes('not_interested') || sentiment === 'not_interested' || sentiment === 'negative') return 'not_interested'
  if (sentiment === 'positive') return 'positive'
  return 'unclear'
}

export function decodeHtml(str: string): string {
  return (str ?? '')
    .replace(/&amp;/g, '&').replace(/&ndash;/g, '–').replace(/&mdash;/g, '—')
    .replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ')
    .replace(/&#\d+;/g, (m) => String.fromCharCode(parseInt(m.slice(2, -1)))).trim()
}

/** Short "why recommended" line from tier fields. */
export function recommendReason(c: Record<string, unknown>): string {
  const bits: string[] = []
  if (c.customer_tier) bits.push(`${c.customer_tier} 级`)
  if (c.recommended_development_strategy) bits.push(String(c.recommended_development_strategy))
  else if (Array.isArray(c.product_match) && c.product_match.length) {
    const pm = c.product_match[0] as { category?: string; level?: string }
    if (pm?.category) bits.push(`${pm.category} ${pm.level ?? ''} 匹配`)
  } else if (c.next_action) bits.push(String(c.next_action))
  return bits.join(' · ') || '符合目标画像'
}
