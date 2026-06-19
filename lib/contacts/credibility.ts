/**
 * Email credibility — how much we trust a contact's email, as a tiered model.
 *
 * Modern brands (Alo, Vuori, Gymshark, Oner Active…) run Google Workspace
 * catch-all domains that intentionally defeat SMTP verification. SMTP-only trust
 * therefore permanently suppresses real contacts. So we tier by SOURCE, not just
 * SMTP success:
 *
 *   Verified (100) 🟢 — SMTP-confirmed or Hunter-confirmed deliverable.
 *   Trusted  (90)  🟢 — from a people database (Apollo / RocketReach / ZoomInfo);
 *                        the person + email are real even if SMTP is blocked.
 *   Probable (70)  🟡 — pattern-generated on an MX-valid company domain / scraped.
 *   Guessed  (40)  🔴 — AI-inferred / low-confidence guess.
 *   None           — no email at all.
 *
 * "Reachable" = Verified OR Trusted (see lib/contacts/access.ts). Auto-SEND still
 * requires Verified (see lib/contacts/readiness.ts) — Trusted counts toward
 * coverage/Access but isn't auto-blasted (bounce safety).
 */
export type CredibilityTier = 'verified' | 'trusted' | 'probable' | 'guessed' | 'none'

export interface CredibilityInput {
  email?: string | null
  email_verified?: boolean | null
  email_deliverable?: boolean | null
  email_confidence?: number | null
  email_source?: string | null
}

export interface Credibility {
  tier: CredibilityTier
  score: number          // 100 / 90 / 70 / 40 / 0
  tierLabel: string      // ✓ Verified / ◆ Trusted / ~ Probable / ? Guessed / 无邮箱
  sourceLabel: string    // Apollo / Hunter / RocketReach / 官网抓取 / 格式推测 / AI 推断
  statusLabel: string
  risk: 'send' | 'caution' | 'avoid'
  riskLabel: string      // 🟢 可发 / 🟡 谨慎 / 🔴 勿发
  badgeClass: string     // tailwind classes for the tier badge
}

/** SMTP/Hunter-confirmed sources → Verified. */
const VERIFIED_SOURCES = ['hunter', 'pattern_smtp', 'domain_search']
/** People-database sources → Trusted (real person/email even if SMTP is blocked). */
const TRUSTED_SOURCES = ['apollo', 'rocketreach', 'zoominfo']
/** Pattern/site-derived but plausible → Probable. */
const PROBABLE_SOURCES = ['pattern_catchall', 'scraped', 'website_email', 'serper_domestic']

const SOURCE_LABELS: Record<string, string> = {
  apollo: 'Apollo',
  rocketreach: 'RocketReach',
  zoominfo: 'ZoomInfo',
  hunter: 'Hunter',
  domain_search: 'Hunter 域名',
  pattern_smtp: 'SMTP 验证',
  pattern_catchall: '格式推测',
  scraped: '官网抓取',
  website_email: '官网邮箱',
  guessed: '格式推测',
  ai_inferred: 'AI 推断',
  serper_domestic: '网络检索',
}

export function computeCredibility(c: CredibilityInput): Credibility {
  const source = (c.email_source ?? '').toLowerCase()
  const sourceLabel = SOURCE_LABELS[source] ?? (source ? source : '未知')
  const conf = c.email_confidence ?? 0

  if (!c.email || !c.email.trim()) {
    return { tier: 'none', score: 0, tierLabel: '无邮箱', sourceLabel: '—', statusLabel: '无邮箱', risk: 'avoid', riskLabel: '🔴 无邮箱', badgeClass: 'bg-gray-100 text-gray-500' }
  }
  // Known bounce → never send, lowest trust.
  if (c.email_deliverable === false) {
    return { tier: 'guessed', score: 0, tierLabel: '✗ 不可达', sourceLabel, statusLabel: '不可达（已退信）', risk: 'avoid', riskLabel: '🔴 勿发', badgeClass: 'bg-red-100 text-red-700' }
  }
  // Tier 1 — Verified: SMTP/Hunter confirmed.
  if (c.email_verified === true || c.email_deliverable === true || VERIFIED_SOURCES.includes(source)) {
    return { tier: 'verified', score: 100, tierLabel: '✓ Verified', sourceLabel, statusLabel: '已验证可达', risk: 'send', riskLabel: '🟢 可发', badgeClass: 'bg-green-100 text-green-700' }
  }
  // Tier 2 — Trusted: people-database source (counts as reachable; SMTP not required).
  if (TRUSTED_SOURCES.includes(source)) {
    return { tier: 'trusted', score: 90, tierLabel: '◆ Trusted', sourceLabel, statusLabel: '可信源·人/邮箱真实', risk: 'send', riskLabel: '🟢 可达', badgeClass: 'bg-emerald-100 text-emerald-700' }
  }
  // Tier 3 — Probable: pattern on a real domain / scraped, or decent confidence.
  if (PROBABLE_SOURCES.includes(source) || conf >= 0.5) {
    return { tier: 'probable', score: 70, tierLabel: '~ Probable', sourceLabel, statusLabel: '格式可能·未验证', risk: 'caution', riskLabel: '🟡 谨慎', badgeClass: 'bg-amber-100 text-amber-700' }
  }
  // Tier 4 — Guessed: AI-inferred / low-confidence.
  return { tier: 'guessed', score: 40, tierLabel: '? Guessed', sourceLabel, statusLabel: '推测·未验证', risk: 'avoid', riskLabel: '🔴 勿发', badgeClass: 'bg-red-100 text-red-700' }
}

/** Sort weight so the most credible contacts rise to the top. */
export function credibilityRank(tier: CredibilityTier): number {
  switch (tier) {
    case 'verified': return 4
    case 'trusted': return 3
    case 'probable': return 2
    case 'guessed': return 1
    default: return 0
  }
}

/** "Reachable" = a contact we can count on for coverage/access (Verified OR Trusted). */
export function isReachableTier(tier: CredibilityTier): boolean {
  return tier === 'verified' || tier === 'trusted'
}
