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
  // Mock data for development without API key
  return [
    {
      title: 'Gymshark - Gym Clothes & Workout Wear',
      link: 'https://www.gymshark.com',
      snippet: 'Shop the latest gym wear and workout clothes for men and women.',
      domain: 'gymshark.com',
    },
    {
      title: 'Lululemon Athletica - Yoga Pants, Athletic Gear',
      link: 'https://www.lululemon.com',
      snippet: 'Technical athletic apparel for yoga, running, training and most other activities.',
      domain: 'lululemon.com',
    },
    {
      title: 'Alphalete Athletics - Premium Fitness Apparel',
      link: 'https://alphaleteathletics.com',
      snippet: 'Premium fitness apparel designed for serious athletes.',
      domain: 'alphaleteathletics.com',
    },
  ].slice(0, 3)
}
