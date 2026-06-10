export interface SearchResult {
  title: string
  link: string
  snippet: string
  domain: string
}

export interface SerperResponse {
  organic: Array<{
    title: string
    link: string
    snippet: string
    position: number
  }>
}

export async function googleSearch(query: string, num = 10): Promise<SearchResult[]> {
  const apiKey = process.env.SERPER_API_KEY
  if (!apiKey || apiKey === 'your_serper_api_key') {
    console.warn('[GoogleScraper] No SERPER_API_KEY set — using mock results')
    return getMockResults(query)
  }

  try {
    const res = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: {
        'X-API-KEY': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ q: query, num }),
    })

    if (!res.ok) {
      console.error('[GoogleScraper] Serper API error:', res.status)
      return []
    }

    const data = (await res.json()) as SerperResponse
    return (data.organic ?? []).map((r) => ({
      title: r.title,
      link: r.link,
      snippet: r.snippet,
      domain: extractDomain(r.link),
    }))
  } catch (err) {
    console.error('[GoogleScraper] Error:', err)
    return []
  }
}

export function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace('www.', '')
  } catch {
    return url
  }
}

function getMockResults(query: string): SearchResult[] {
  // Mock data for development without SERPER_API_KEY
  // Uses fictional domains that won't be caught by the blocklist
  console.warn('[GoogleScraper] SERPER_API_KEY not set — returning mock results (dev mode only)')
  return [
    {
      title: 'Peakform Activewear - Yoga & Running Apparel',
      link: 'https://www.peakformactive.co',
      snippet: 'DTC activewear brand specialising in yoga leggings, sports bras and running gear.',
      domain: 'peakformactive.co',
    },
    {
      title: 'Solstice Sportswear | Sustainable Athletic Wear',
      link: 'https://solsticesportswear.com',
      snippet: 'Eco-friendly activewear made from recycled materials. Leggings, bras, and shorts.',
      domain: 'solsticesportswear.com',
    },
    {
      title: 'IronVeil Fitness – Gym & Training Apparel',
      link: 'https://ironveilfitness.com',
      snippet: 'Performance training apparel for serious athletes. Private label gym wear.',
      domain: 'ironveilfitness.com',
    },
  ].slice(0, 3)
}
