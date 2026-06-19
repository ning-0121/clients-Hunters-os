/**
 * Corporate mail-domain resolver.
 *
 * A company's browsing domain is often a storefront / locale / CDN host
 * (us.oneractive.com, shop.brand.com, www.brand.com) whose apex is the real
 * corporate mail domain (oneractive.com, brand.com). Email guessing/verification
 * must use the corporate mail domain — NOT the storefront host — otherwise SMTP /
 * Hunter look up the wrong domain and verify nothing.
 *
 * Keep the original website/domain for browsing & enrichment (Apollo org search,
 * scraping). Use the resolved mail domain ONLY for email generation/verification.
 */
import dns from 'dns/promises'

// Leading subdomain labels that are storefront / locale / marketing — never the mail host.
const STOREFRONT_PREFIXES = new Set([
  'www', 'shop', 'store', 'go', 'app', 'm', 'info', 'mail', 'email', 'em', 'send',
  'order', 'orders', 'help', 'support', 'blog', 'news', 'cdn', 'assets',
  'us', 'uk', 'eu', 'ca', 'au', 'de', 'fr', 'es', 'it', 'nl', 'se', 'dk', 'no', 'fi',
  'pl', 'pt', 'ie', 'nz', 'jp', 'cn', 'kr', 'hk', 'sg', 'in', 'mx', 'br', 'za', 'ae',
])

// Common multi-label public suffixes so we keep the correct registrable domain.
const MULTI_TLD = new Set([
  'co.uk', 'org.uk', 'me.uk', 'com.au', 'net.au', 'org.au', 'co.nz', 'com.br', 'com.cn',
  'com.hk', 'com.sg', 'com.mx', 'co.za', 'co.jp', 'co.kr', 'co.in', 'com.tr',
])

const FREE_EMAIL = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'ymail.com', 'hotmail.com', 'outlook.com',
  'live.com', 'msn.com', 'icloud.com', 'me.com', 'aol.com', 'proton.me', 'protonmail.com',
  'gmx.com', 'mail.com', 'qq.com', '163.com', '126.com', 'foxmail.com', 'sina.com', 'yandex.com',
])

function cleanHost(input: string): string {
  return input.toLowerCase().trim()
    .replace(/^https?:\/\//, '')
    .replace(/^[^@/]*@/, '')         // tolerate an email being passed in
    .split('/')[0].split('?')[0].split(':')[0]
    .replace(/\.$/, '')
}

/** Registrable domain (eTLD+1), honoring a few multi-label public suffixes. */
export function registrableDomain(input: string): string {
  const host = cleanHost(input)
  const parts = host.split('.').filter(Boolean)
  if (parts.length <= 2) return host
  const lastTwo = parts.slice(-2).join('.')
  if (MULTI_TLD.has(lastTwo) && parts.length >= 3) return parts.slice(-3).join('.')
  return lastTwo
}

/** Strip a leading storefront/locale label, returning the registrable mail domain. */
export function stripStorefront(input: string): string {
  const host = cleanHost(input)
  const parts = host.split('.').filter(Boolean)
  if (parts.length > 2 && STOREFRONT_PREFIXES.has(parts[0])) {
    return registrableDomain(parts.slice(1).join('.'))
  }
  return registrableDomain(host)
}

/**
 * Pure best-guess mail domain from available evidence (no network):
 *   1. a corporate (non-free) domain seen in known emails wins
 *   2. else the website host's registrable domain (storefront stripped)
 *   3. else the company domain's registrable domain
 */
export function pickMailDomain(opts: { domain?: string | null; website?: string | null; knownEmails?: string[] }): string | null {
  for (const e of opts.knownEmails ?? []) {
    const d = cleanHost(e.includes('@') ? e.split('@')[1] : e)
    if (d && !FREE_EMAIL.has(registrableDomain(d))) return registrableDomain(d)
  }
  if (opts.website) { const d = stripStorefront(opts.website); if (d) return d }
  if (opts.domain) { const d = stripStorefront(opts.domain); if (d) return d }
  return null
}

/**
 * Resolve the mail domain, preferring one that actually has MX records.
 * Falls back to the pure pick if MX lookups fail/timeout (offline-safe).
 */
export async function resolveMailDomain(opts: { domain?: string | null; website?: string | null; knownEmails?: string[] }): Promise<string | null> {
  const pick = pickMailDomain(opts)
  if (!pick) return null
  try {
    const mx = await dns.resolveMx(pick).catch(() => [])
    if (mx && mx.length) return pick
    // apex has no MX → try the original domain's registrable form as a fallback
    const orig = opts.domain ? registrableDomain(opts.domain) : null
    if (orig && orig !== pick) {
      const mx2 = await dns.resolveMx(orig).catch(() => [])
      if (mx2 && mx2.length) return orig
    }
  } catch {
    /* offline / DNS error → use the pure pick */
  }
  return pick
}
