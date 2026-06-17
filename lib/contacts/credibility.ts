/**
 * Email credibility — the single source of truth for "should I send to this?"
 * Derived from the verification signals we already store on a contact
 * (email_verified / email_deliverable / email_confidence / email_source).
 *
 *   Verified  🟢 — confirmed deliverable (Hunter) / Apollo-verified / official-site + reachable → send
 *   Likely    🟡 — credible source but not fully verified (catch-all/risky/Apollo/Hunter/SMTP) → send with care
 *   Guessed   🔴 — pure pattern guess, unverified, low confidence → don't send, verify or switch person
 *   None         — no email at all
 */
export type CredibilityTier = 'verified' | 'likely' | 'guessed' | 'none'

export interface CredibilityInput {
  email?: string | null
  email_verified?: boolean | null
  email_deliverable?: boolean | null
  email_confidence?: number | null
  email_source?: string | null
}

export interface Credibility {
  tier: CredibilityTier
  tierLabel: string      // ✓ Verified / ~ Likely / ? Guessed / 无邮箱
  sourceLabel: string    // Apollo / Hunter / 官网抓取 / 格式推测 / 网络检索 / AI 推断
  statusLabel: string    // 可达 / 接收全部 / 风险 / 未验证 / 不可达
  risk: 'send' | 'caution' | 'avoid'
  riskLabel: string      // 🟢 可发 / 🟡 谨慎 / 🔴 勿发
  badgeClass: string     // tailwind classes for the tier badge
}

const TRUSTED = ['apollo', 'hunter', 'scraped', 'pattern_smtp', 'domain_search']

const SOURCE_LABELS: Record<string, string> = {
  apollo: 'Apollo',
  hunter: 'Hunter',
  scraped: '官网抓取',
  domain_search: 'Hunter 域名',
  pattern_smtp: 'SMTP 验证',
  pattern_catchall: '格式推测',
  guessed: '格式推测',
  ai_inferred: 'AI 推断',
  serper_domestic: '网络检索',
}

export function computeCredibility(c: CredibilityInput): Credibility {
  const source = (c.email_source ?? '').toLowerCase()
  const sourceLabel = SOURCE_LABELS[source] ?? (source ? source : '未知')
  const conf = c.email_confidence ?? 0

  if (!c.email || !c.email.trim()) {
    return { tier: 'none', tierLabel: '无邮箱', sourceLabel: '—', statusLabel: '无邮箱', risk: 'avoid', riskLabel: '🔴 无邮箱', badgeClass: 'bg-gray-100 text-gray-500' }
  }
  if (c.email_deliverable === false) {
    return { tier: 'guessed', tierLabel: '✗ 不可达', sourceLabel, statusLabel: '不可达（已退信）', risk: 'avoid', riskLabel: '🔴 勿发', badgeClass: 'bg-red-100 text-red-700' }
  }
  if (c.email_verified === true || c.email_deliverable === true) {
    return { tier: 'verified', tierLabel: '✓ Verified', sourceLabel, statusLabel: '已验证可达', risk: 'send', riskLabel: '🟢 可发', badgeClass: 'bg-green-100 text-green-700' }
  }
  const trusted = TRUSTED.includes(source) || conf >= 0.6
  if (trusted) {
    return { tier: 'likely', tierLabel: '~ Likely', sourceLabel, statusLabel: '来源可信·未完全验证', risk: 'caution', riskLabel: '🟡 谨慎', badgeClass: 'bg-amber-100 text-amber-700' }
  }
  return { tier: 'guessed', tierLabel: '? Guessed', sourceLabel, statusLabel: '推测·未验证', risk: 'avoid', riskLabel: '🔴 勿发', badgeClass: 'bg-red-100 text-red-700' }
}

/** Sort weight so verified contacts rise to the top. */
export function credibilityRank(tier: CredibilityTier): number {
  return tier === 'verified' ? 3 : tier === 'likely' ? 2 : tier === 'guessed' ? 1 : 0
}
