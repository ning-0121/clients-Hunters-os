/**
 * Customs intelligence via Serper (Google), not direct scraping.
 *
 * ImportYeti hosts US customs / bill-of-lading data — who imports from whom —
 * but it's behind a Cloudflare challenge (a direct fetch returns 403). Google
 * has already indexed those pages, so we query Serper for the company's
 * ImportYeti page and pull the supplier/buyer hints out of the search snippets.
 * Free, stable, no anti-bot fight. Snippets only — full shipment detail still
 * requires opening the ImportYeti page by hand (one-click link provided in UI).
 */
import { googleSearch } from '@/agents/discovery/scrapers/google-scraper'

export interface CustomsLookup {
  importyetiUrl: string | null   // best ImportYeti page found via Google
  searchUrl: string              // one-click ImportYeti search for this company
  snippets: string[]             // Google snippets from ImportYeti pages
  supplierHints: string[]        // best-effort factory/supplier names extracted
  checkedAt: string
}

/** Pull factory/supplier-looking names out of snippet text. Best-effort. */
function extractSuppliers(snippets: string[]): string[] {
  const text = snippets.join(' · ')
  const out = new Set<string>()
  // ImportYeti phrasing: "...top supplier is Jm Fabrics. They primarily import..."
  for (const m of text.matchAll(/(?:top\s+)?supplier(?:'s)?\s+is\s+([A-Z][\w&.\- ]+?)(?:\.|,|;| They| with| from|$)/gi)) {
    const n = m[1].trim()
    if (n.length > 2) out.add(n)
  }
  // Multi-word proper names ending in a manufacturing keyword.
  for (const m of text.matchAll(/([A-Z][\w&.\-]+(?:\s+[A-Z][\w&.\-]+){1,5}\s+(?:Textile|Textiles|Garment|Garments|Apparel|Clothing|Knitting|Knitwear|Industrial|Manufacturing|Sportswear|Fashion|Co\.?,?\s?Ltd|Limited))/g)) {
    out.add(m[1].trim())
  }
  return [...out].slice(0, 10)
}

export async function lookupCustoms(name: string, domain?: string | null): Promise<CustomsLookup> {
  const clean = name.replace(/\s*\(validation\)\s*/i, '').trim()
  const queries = [
    `${clean} site:importyeti.com`,
    domain ? `${domain} site:importyeti.com` : `"${clean}" importyeti supplier OR manufacturer`,
  ]
  const results = (await Promise.all(queries.map((q) => googleSearch(q, 8).catch(() => [])))).flat()
  const iy = results.filter((r) => r.domain.includes('importyeti.com'))
  const snippets = [...new Set(iy.map((r) => r.snippet).filter(Boolean))].slice(0, 5)

  return {
    importyetiUrl: iy[0]?.link ?? null,
    searchUrl: `https://www.importyeti.com/search?q=${encodeURIComponent(clean)}`,
    snippets,
    supplierHints: extractSuppliers(snippets),
    checkedAt: new Date().toISOString(),
  }
}
