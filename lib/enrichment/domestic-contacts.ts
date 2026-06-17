/**
 * Domestic (China) contact finder. Apollo / Hunter don't cover Chinese companies,
 * so we use Serper (Google) + their own website and regex-extract phone / email /
 * WeChat from the snippets & page text. Best-effort — surfaces what's publicly
 * indexed; never fabricates.
 */
import { googleSearch } from '@/agents/discovery/scrapers/google-scraper'
import { scrapeWebsite } from '@/agents/discovery/scrapers/website-scraper'

export interface DomesticContacts {
  phones: string[]       // mobiles (1xx...) + landlines
  emails: string[]
  wechats: string[]
  sources: string[]      // urls we pulled from
  checkedAt: string
}

const MOBILE_RE   = /(?<!\d)1[3-9]\d{9}(?!\d)/g
const LANDLINE_RE = /(?<!\d)0\d{2,3}[-\s]?\d{7,8}(?!\d)/g
const EMAIL_RE    = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g
const WECHAT_RE   = /(?:微信号?|wechat|加微信?|vx|薇信)[：:\s]*([a-zA-Z][a-zA-Z0-9_-]{4,19})/gi

function uniqClean(arr: string[]): string[] {
  return [...new Set(arr.map((s) => s.trim()).filter(Boolean))]
}

function extractFrom(text: string): { phones: string[]; emails: string[]; wechats: string[] } {
  const phones = [...(text.match(MOBILE_RE) ?? []), ...(text.match(LANDLINE_RE) ?? [])]
  const emails = (text.match(EMAIL_RE) ?? [])
    // drop obvious junk / image asset emails
    .filter((e) => !/\.(png|jpg|jpeg|gif|webp)$/i.test(e))
  const wechats: string[] = []
  let m: RegExpExecArray | null
  const re = new RegExp(WECHAT_RE)
  while ((m = re.exec(text)) !== null) { if (m[1]) wechats.push(m[1]) }
  return { phones: uniqClean(phones), emails: uniqClean(emails), wechats: uniqClean(wechats) }
}

export async function findDomesticContacts(name: string, website?: string | null): Promise<DomesticContacts> {
  const clean = name.replace(/\s*\(validation\)\s*/i, '').trim()
  const queries = [
    `"${clean}" 联系电话`,
    `"${clean}" 邮箱 联系方式`,
    `"${clean}" 微信`,
  ]
  const sources: string[] = []
  let corpus = ''

  // 1. Serper snippets
  const results = (await Promise.all(queries.map((q) => googleSearch(q, 8).catch(() => [])))).flat()
  for (const r of results) {
    corpus += ` ${r.title ?? ''} ${r.snippet ?? ''}`
    if (r.link) sources.push(r.link)
  }

  // 2. Their own website (often lists 电话/邮箱 on contact pages)
  if (website) {
    try {
      const site = await scrapeWebsite(website)
      if (site?.bodyText) corpus += ` ${site.bodyText}`
      if (Array.isArray(site?.emails)) corpus += ` ${site.emails.join(' ')}`
      sources.push(website)
    } catch { /* noop */ }
  }

  const ext = extractFrom(corpus)
  return {
    phones: ext.phones.slice(0, 8),
    emails: ext.emails.slice(0, 8),
    wechats: ext.wechats.slice(0, 5),
    sources: uniqClean(sources).slice(0, 8),
    checkedAt: new Date().toISOString(),
  }
}
