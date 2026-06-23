/**
 * ImportYeti lookup — real US import/customs data (bills of lading). Gives us
 * what the brief was guessing: the importer's HQ address, real import volume,
 * destination country, and (best-effort) the origin countries + supplier names
 * they actually ship from. EVIDENCE, not inference.
 *
 * The /api/search endpoint returns clean JSON and is the reliable spine. The
 * supplier roster lives in the company page HTML; we extract it best-effort and
 * degrade gracefully (origins/suppliers may be empty) — never fabricated.
 */
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36'
const BASE = 'https://www.importyeti.com'

export interface ImportYetiSupplier { name: string; countryCode: string; shipments?: number }
export interface ImportYetiResult {
  matched: boolean                   // true only for a HIGH-confidence name match
  confidence: 'high' | 'low' | 'none'
  query: string
  companyName?: string
  hqAddress?: string | null
  countryCode?: string | null
  totalShipments?: number | null
  mostRecentShipment?: string | null
  companyUrl?: string | null         // absolute ImportYeti company page (also the review link for low-confidence)
  originCountries: string[]          // ISO codes seen on the company's shipments
  suppliers: ImportYetiSupplier[]    // best-effort
}

// Generic suffixes that may decorate a real importer name without changing identity.
const GENERIC_TOK = new Set([
  'us', 'usa', 'inc', 'llc', 'ltd', 'corp', 'co', 'company', 'finished', 'goods',
  'brand', 'brands', 'intl', 'international', 'holdings', 'trading', 'the', 'of', 'na', 'america', 'imports', 'import',
])

interface SearchRow {
  title: string; countryCode: string; type: string; address: string
  totalShipments: number; mostRecentShipment?: string; url: string
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

async function getText(url: string, timeoutMs = 12000): Promise<string | null> {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json,text/html,*/*' }, signal: AbortSignal.timeout(timeoutMs) })
    if (!r.ok) return null
    return await r.text()
  } catch { return null }
}

// Manufacturing-origin countries — an importer row with one of these as its
// country is almost always a supplier/factory, NOT the brand's HQ.
const ORIGIN_CC = new Set(['CN', 'VN', 'BD', 'IN', 'KH', 'ID', 'PK', 'LK', 'MM', 'TH', 'TW', 'HK'])
// Consumer markets where a DTC brand's US-import consignee plausibly sits. A
// match outside these (e.g. a "Reprise" in Tunisia) is a namesake, not the brand.
const CONSUMER_CC = new Set(['US', 'GB', 'CA', 'AU', 'IE', 'NZ', 'DE', 'FR', 'NL', 'SE', 'DK', 'NO', 'FI', 'ES', 'IT', 'BE', 'AT', 'CH', 'JP', 'KR', 'SG'])
// A consignee whose ADDRESS names a manufacturing/origin country is a namesake or
// a factory, not a Western DTC brand's HQ — even if its countryCode looks fine.
const ODD_ADDR_RE = /\b(tunisia|pakistan|bangladesh|china|vietnam|india|cambodia|egypt|turkey|sri lanka|myanmar|indonesia|morocco)\b/i

/**
 * Pick the importer (brand) row — STRICT, to avoid false HQ assignments. Requires
 * a real name match (full containment, or every distinctive query token present),
 * prefers type:company in a consumer market over an origin-country entity, then
 * volume. Returns undefined when nothing matches confidently (→ no populate,
 * better than a wrong address).
 */
function pickCompany(rows: SearchRow[], query: string): { row: SearchRow; confidence: 'high' | 'low' } | undefined {
  const q = norm(query)
  const qTokens = q.split(' ').filter(Boolean)
  const qSet = new Set(qTokens)
  const scored = rows
    .map((r) => {
      const tTokens = norm(r.title).split(' ').filter(Boolean)
      const tSet = new Set(tTokens)
      const missing = qTokens.filter((w) => !tSet.has(w))               // query tokens absent from title
      const extra = tTokens.filter((w) => !qSet.has(w) && !GENERIC_TOK.has(w) && !/^\d+$/.test(w)) // distinctive extra tokens
      // HIGH = exact brand-name match (± generic suffixes) AND in a consumer market
      // (a namesake importer in an origin/odd country is not the brand's HQ).
      const high = missing.length === 0 && extra.length === 0 && CONSUMER_CC.has(r.countryCode) && !ODD_ADDR_RE.test(r.address ?? '')
      const overlap = qTokens.length - missing.length
      return { r, high, overlap, isCompany: r.type === 'company', isConsumerMkt: !ORIGIN_CC.has(r.countryCode) }
    })
    .filter((x) => x.overlap > 0)
  if (!scored.length) return undefined
  scored.sort((a, b) =>
    Number(b.high) - Number(a.high) ||
    Number(b.isCompany) - Number(a.isCompany) ||
    Number(b.isConsumerMkt) - Number(a.isConsumerMkt) ||
    b.r.totalShipments - a.r.totalShipments,
  )
  const best = scored[0]
  return { row: best.r, confidence: best.high ? 'high' : 'low' }
}

const ORIGIN_HINT = /\b(CN|VN|BD|IN|KH|ID|TR|PK|PT|LK|TW|TH|MM|HK)\b/g

/** Best-effort: pull distinct supplier origin countries + names from the company page HTML. */
function extractFromCompanyPage(html: string): { originCountries: string[]; suppliers: ImportYetiSupplier[] } {
  const suppliers: ImportYetiSupplier[] = []
  // Supplier objects in the embedded data blob, e.g. {"title":"X Garments","countryCode":"VN",...,"totalShipments":42,...}
  const re = /\{"title":"([^"]{2,80})","countryCode":"([A-Z]{2})"[^}]*?"totalShipments":(\d+)/g
  let m: RegExpExecArray | null
  const seen = new Set<string>()
  while ((m = re.exec(html)) && suppliers.length < 40) {
    const [, name, cc, ship] = m
    const key = norm(name)
    if (seen.has(key)) continue
    seen.add(key)
    suppliers.push({ name, countryCode: cc, shipments: Number(ship) })
  }
  // Origin countries: prefer the manufacturing origins (non-US) from supplier rows.
  const origins = Array.from(new Set(suppliers.map((s) => s.countryCode).filter((c) => c && c !== 'US')))
  const fallback = origins.length ? origins : Array.from(new Set((html.match(ORIGIN_HINT) ?? []))).slice(0, 6)
  return { originCountries: fallback, suppliers: suppliers.filter((s) => s.countryCode !== 'US').slice(0, 12) }
}

export async function importYetiLookup(query: string): Promise<ImportYetiResult> {
  const empty: ImportYetiResult = { matched: false, confidence: 'none', query, originCountries: [], suppliers: [] }
  const body = await getText(`${BASE}/api/search?q=${encodeURIComponent(query)}`)
  if (!body) return empty
  let rows: SearchRow[]
  try { rows = (JSON.parse(body).searchResults ?? []) as SearchRow[] } catch { return empty }
  if (!rows.length) return empty

  const pick = pickCompany(rows, query)
  if (!pick) return empty
  const co = pick.row
  const companyUrl = co.url ? `${BASE}/${co.url.replace(/^\//, '')}` : null

  // LOW confidence: a name-collision candidate — surface the link for human review,
  // but DO NOT assert HQ/origin as fact (that's how P.E Nation got a Hangzhou address).
  if (pick.confidence === 'low') {
    return { matched: false, confidence: 'low', query, companyName: co.title, companyUrl, originCountries: [], suppliers: [] }
  }

  let originCountries: string[] = []
  let suppliers: ImportYetiSupplier[] = []
  if (companyUrl && co.type === 'company') {
    const page = await getText(companyUrl, 15000)
    if (page) ({ originCountries, suppliers } = extractFromCompanyPage(page))
  }

  return {
    matched: true,
    confidence: 'high',
    query,
    companyName: co.title,
    hqAddress: co.address || null,
    countryCode: co.countryCode || null,
    totalShipments: co.totalShipments ?? null,
    mostRecentShipment: co.mostRecentShipment ?? null,
    companyUrl,
    originCountries,
    suppliers,
  }
}
