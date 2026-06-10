/**
 * Trigger Detector
 *
 * Identifies buying-signal events on brand websites:
 *
 * NEW_PRODUCT_LAUNCH  → brand just launched new styles — sourcing partner conversation is timely
 * SUSTAINABILITY_PIVOT → brand pivoting to eco materials — aligns with GOTS/OEKO-TEX strengths
 * SCALING_SIGNAL       → reviews growing, new markets, wholesale expansion
 * PRESS_MENTION       → PR = brand is growing = needs supply chain
 * FUNDING_SIGNAL       → funded brand = capex for manufacturing
 *
 * These triggers inform both scoring AND personalized email icebreakers.
 */

export interface TriggerResult {
  triggers:           TriggerEvent[]
  primaryTrigger:     TriggerEvent | null
  personalization:    string | null  // ready-to-use icebreaker sentence
}

export interface TriggerEvent {
  type:    'new_product' | 'sustainability' | 'scaling' | 'press' | 'funding' | 'review_growth'
  detail:  string
  score:   number   // 0-10 urgency/relevance
  url?:    string
}

// ── New Product Detection ─────────────────────────────────────────────────────

const NEW_PRODUCT_SIGNALS = [
  /new\s+(arrival|collection|drop|style|release|launch)/i,
  /just\s+(dropped|launched|released|arrived)/i,
  /introducing\s+our\s+new/i,
  /shop\s+(the\s+)?new/i,
  /fresh\s+(arrivals|drops)/i,
  /limited\s+(edition|drop|release)/i,
  /pre\-order/i,
]

const SUSTAINABILITY_SIGNALS = [
  /organic\s+cotton/i,
  /gots\s+certified/i,
  /oeko.tex/i,
  /recycled\s+(fabric|material|polyester)/i,
  /sustainable\s+(sourcing|manufacturing|fabric)/i,
  /eco.friendly/i,
  /bamboo\s+(fabric|blend|jersey)/i,
  /regenerative/i,
  /b.?corp/i,
  /climate\s+(neutral|positive|pledge)/i,
]

const SCALING_SIGNALS = [
  /wholesale/i,
  /retail\s+partner/i,
  /stockist/i,
  /now\s+(available|selling)\s+(in|at|on)/i,
  /international\s+shipping/i,
  /we\s+(ship|deliver)\s+(worldwide|globally)/i,
  /now\s+in\s+\d+\s+countries/i,
]

const PRESS_SIGNALS = [
  /as\s+seen\s+(in|on)/i,
  /featured\s+in/i,
  /press\s+coverage/i,
  /in\s+the\s+(news|media|press)/i,
  /(forbes|vogue|elle|shape|women's\s+health|runner's\s+world|nytimes|wsj)/i,
]

const FUNDING_SIGNALS = [
  /series\s+[ab]/i,
  /seed\s+round/i,
  /raised\s+\$[\d.]+\s*(m|million)/i,
  /funded\s+by/i,
  /venture.backed/i,
  /investor/i,
]

export async function detectTriggers(params: {
  website:   string
  bodyText:  string
  domain?:   string
}): Promise<TriggerResult> {
  const { website, bodyText } = params
  const text = bodyText.toLowerCase()
  const triggers: TriggerEvent[] = []

  // 1. New products
  const newProductMatches = NEW_PRODUCT_SIGNALS
    .map(p => text.match(p))
    .filter(Boolean)

  if (newProductMatches.length > 0) {
    // Try to scrape /new-arrivals or /collections/new for specifics
    let detail = 'new products detected on website'
    const newArrivalsText = await scrapePath(website, ['/collections/new-arrivals', '/collections/new', '/new-arrivals'])
    if (newArrivalsText) {
      const productNames = extractProductNames(newArrivalsText)
      if (productNames.length > 0) {
        detail = `new products: ${productNames.slice(0, 3).join(', ')}`
      }
    }
    triggers.push({ type: 'new_product', detail, score: 7 })
  }

  // 2. Sustainability
  const sustainMatches = SUSTAINABILITY_SIGNALS
    .map(p => text.match(p))
    .filter(Boolean)

  if (sustainMatches.length >= 2) {
    const matched = sustainMatches.slice(0, 3).map(m => m![0]).join(', ')
    triggers.push({
      type: 'sustainability',
      detail: `sustainability-focused brand: ${matched}`,
      score: 8,   // High relevance — aligns with GOTS/OEKO-TEX factory strengths
    })
  }

  // 3. Scaling signals
  const scaleMatches = SCALING_SIGNALS.map(p => text.match(p)).filter(Boolean)
  if (scaleMatches.length >= 2) {
    triggers.push({ type: 'scaling', detail: 'expanding distribution or markets', score: 6 })
  }

  // 4. Press
  const pressMatches = PRESS_SIGNALS.map(p => text.match(p)).filter(Boolean)
  if (pressMatches.length > 0) {
    const mention = pressMatches[0]![0]
    triggers.push({ type: 'press', detail: `press coverage: ${mention}`, score: 6 })
  }

  // 5. Funding
  const fundingMatches = FUNDING_SIGNALS.map(p => text.match(p)).filter(Boolean)
  if (fundingMatches.length > 0) {
    triggers.push({ type: 'funding', detail: 'funding or investment signals', score: 9 })
  }

  const sorted = triggers.sort((a, b) => b.score - a.score)
  const primary = sorted[0] ?? null

  return {
    triggers: sorted,
    primaryTrigger: primary,
    personalization: primary ? generatePersonalization(primary) : null,
  }
}

function generatePersonalization(trigger: TriggerEvent): string {
  switch (trigger.type) {
    case 'new_product':
      return `Noticed the new collection drop — launching new styles consistently is exactly where factory relationships matter most for lead time predictability.`

    case 'sustainability':
      return `The organic/sustainable focus on the site caught my attention — we're GOTS and OEKO-TEX certified, which most factories in our range aren't.`

    case 'funding':
      return `Congrats on the recent funding — scaling production capacity is usually one of the first operational questions that comes up. Happy to share how we handle that stage.`

    case 'press':
      return `Saw the press coverage — brands at that visibility stage usually find that MOQ flexibility matters more than price. We specialize in exactly that.`

    case 'scaling':
      return `The expansion into new markets/channels caught my eye — scaling distribution usually creates supply chain pressure faster than expected.`

    default:
      return `Your brand's growth trajectory looks interesting from what I can see on the site.`
  }
}

async function scrapePath(website: string, paths: string[]): Promise<string | null> {
  const base = website.replace(/\/$/, '')
  for (const path of paths) {
    try {
      const res = await fetch(`${base}${path}`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; research-bot/1.0)' },
        signal: AbortSignal.timeout(5000),
      })
      if (!res.ok) continue
      const html = await res.text()
      return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 3000)
    } catch {
      continue
    }
  }
  return null
}

function extractProductNames(text: string): string[] {
  // Extract product-like names (Title Case, 2-5 words)
  const matches = text.matchAll(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,4})\b/g)
  const names = [...matches].map(m => m[1]).filter(n =>
    !['Add To', 'Free Shipping', 'Shop Now', 'New Arrivals', 'Best Sellers', 'View All'].includes(n)
  )
  return [...new Set(names)].slice(0, 5)
}
