import { extractDomain } from './google-scraper'

export interface WebsiteData {
  url: string
  domain: string
  title: string
  description: string
  bodyText: string
  instagramHandle?: string
  tiktokHandle?: string
  linkedinUrl?: string
  shopifyDetected: boolean
  emails: string[]
  hasEcommerce: boolean
}

const SHOPIFY_SIGNALS = [
  'cdn.shopify.com',
  'myshopify.com',
  'Shopify.theme',
  'window.Shopify',
  '/cart.js',
]

const ECOMMERCE_SIGNALS = [
  'add to cart',
  'buy now',
  'shop now',
  'checkout',
  'add to bag',
]

export async function scrapeWebsite(url: string): Promise<WebsiteData | null> {
  if (!url.startsWith('http')) url = `https://${url}`
  const domain = extractDomain(url)

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 8000)

    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; research-bot/1.0)',
        Accept: 'text/html',
      },
    })
    clearTimeout(timeout)

    if (!res.ok) return null

    const html = await res.text()
    return parseHtml(url, domain, html)
  } catch (err) {
    console.warn(`[WebsiteScraper] Failed to scrape ${url}:`, err)
    return null
  }
}

function parseHtml(url: string, domain: string, html: string): WebsiteData {
  // Title
  const titleMatch = html.match(/<title[^>]*>(.*?)<\/title>/is)
  const title = titleMatch ? decodeHtml(titleMatch[1].trim()) : domain

  // Meta description
  const metaDescMatch = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)/i)
    ?? html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i)
  const description = metaDescMatch ? decodeHtml(metaDescMatch[1].trim()) : ''

  // Strip tags for body text (first 3000 chars)
  const bodyText = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 3000)

  // Social handles
  const instagramMatch = html.match(/instagram\.com\/([a-zA-Z0-9._]+)/i)
  const instagramHandle = instagramMatch?.[1]?.replace(/\/$/, '')

  const tiktokMatch = html.match(/tiktok\.com\/@([a-zA-Z0-9._]+)/i)
  const tiktokHandle = tiktokMatch?.[1]

  const linkedinMatch = html.match(/linkedin\.com\/(company|in)\/([a-zA-Z0-9-]+)/i)
  const linkedinUrl = linkedinMatch ? `https://linkedin.com/${linkedinMatch[1]}/${linkedinMatch[2]}` : undefined

  // Emails
  const emailMatches = html.matchAll(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g)
  const emails = [...new Set([...emailMatches].map((m) => m[0]))]
    .filter((e) => !e.includes('example.com') && !e.includes('sentry.io'))
    .slice(0, 5)

  // Shopify detection
  const shopifyDetected = SHOPIFY_SIGNALS.some((s) => html.includes(s))

  // E-commerce detection
  const lowerHtml = html.toLowerCase()
  const hasEcommerce = ECOMMERCE_SIGNALS.some((s) => lowerHtml.includes(s))

  return {
    url,
    domain,
    title,
    description,
    bodyText,
    instagramHandle,
    tiktokHandle,
    linkedinUrl,
    shopifyDetected,
    emails,
    hasEcommerce,
  }
}

function decodeHtml(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
}
