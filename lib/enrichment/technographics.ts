/**
 * Technographic Enrichment
 *
 * Detects what technology stack a brand uses.
 * These signals are critical qualifiers for DTC activewear brands:
 *
 *   Shopify/Shopify Plus → DTC brand (highest fit)
 *   Klaviyo              → email marketing sophistication → scaling brand
 *   ReCharge             → subscription model → recurring revenue → stable buyer
 *   Triple Whale         → aggressive paid media user → fast-growing brand
 *   Gorgias              → mature customer support → operational brand
 *   WooCommerce          → smaller DTC, more price-sensitive
 *   Magento/BigCommerce  → larger operation
 *
 * Approach: HTML pattern matching from website source (free, no API needed)
 * Falls back gracefully if site is unreachable.
 */

export interface TechStack {
  shopify:        boolean
  shopifyPlus:    boolean
  klaviyo:        boolean
  recharg:        boolean
  tripleWhale:    boolean
  gorgias:        boolean
  woocommerce:    boolean
  magento:        boolean
  bigcommerce:    boolean
  attentive:      boolean   // SMS marketing → active brand
  yotpo:          boolean   // reviews → social proof focus
  loox:           boolean   // reviews plugin
  okendo:         boolean   // reviews plugin
  postscript:     boolean   // SMS
  googleAnalytics: boolean
  metaPixel:      boolean
  tiktokPixel:    boolean
  detected:       string[]  // all detected tech names
  confidence:     'high' | 'medium' | 'low'
}

interface TechPattern {
  name:    string
  key:     keyof TechStack
  signals: string[]
  weight:  number  // scoring weight
}

const TECH_PATTERNS: TechPattern[] = [
  { name: 'Shopify Plus',   key: 'shopifyPlus',    signals: ['Shopify.theme','cdn.shopify.com/shopifycloud','shopify-plus'], weight: 3 },
  { name: 'Shopify',        key: 'shopify',        signals: ['cdn.shopify.com','myshopify.com','window.Shopify','Shopify.theme','/cart.js','shopify-section'], weight: 3 },
  { name: 'Klaviyo',        key: 'klaviyo',        signals: ['klaviyo.com','a.klaviyo.com','static.klaviyo.com','KlaviyoSubscribe','_learnq'], weight: 2.5 },
  { name: 'ReCharge',       key: 'recharg',        signals: ['rechargeapps.com','rechargepayments.com','ReCharge','recharge_'],          weight: 2 },
  { name: 'Triple Whale',   key: 'tripleWhale',    signals: ['triplewhale.com','triplePixel','TriplePixel'],                              weight: 2 },
  { name: 'Gorgias',        key: 'gorgias',        signals: ['gorgias.chat','gorgias-chat','gorgiaschat'],                               weight: 1.5 },
  { name: 'Attentive',      key: 'attentive',      signals: ['attentivemobile.com','attn.tv','attentive_tag'],                          weight: 1.5 },
  { name: 'Yotpo',          key: 'yotpo',          signals: ['yotpo.com','staticw2.yotpo.com','yotpo_widget'],                          weight: 1 },
  { name: 'Loox',           key: 'loox',           signals: ['loox.io','loox-cdn','looxcdn'],                                           weight: 1 },
  { name: 'Okendo',         key: 'okendo',         signals: ['okendo.io','okendo-reviews'],                                             weight: 1 },
  { name: 'Postscript',     key: 'postscript',     signals: ['postscript.io','postscript_shopify'],                                     weight: 1.5 },
  { name: 'WooCommerce',    key: 'woocommerce',    signals: ['woocommerce','wp-content/plugins/woocommerce','wc-ajax'],                  weight: 1.5 },
  { name: 'Magento',        key: 'magento',        signals: ['mage/','Magento_Ui','magentoStorefront'],                                 weight: 1 },
  { name: 'BigCommerce',    key: 'bigcommerce',    signals: ['bigcommerce.com','BigCommerce','cdn11.bigcommerce.com'],                   weight: 1 },
  { name: 'Google Analytics', key: 'googleAnalytics', signals: ['gtag/js','google-analytics.com/analytics','UA-','G-'],                weight: 0.5 },
  { name: 'Meta Pixel',     key: 'metaPixel',      signals: ['connect.facebook.net','fbq(','fbevents.js'],                             weight: 1 },
  { name: 'TikTok Pixel',   key: 'tiktokPixel',    signals: ['analytics.tiktok.com','ttq.','TiktokAnalyticsObject'],                    weight: 1.5 },
]

export async function detectTechStack(websiteHtml: string, domain?: string): Promise<TechStack> {
  const result: TechStack = {
    shopify: false, shopifyPlus: false, klaviyo: false, recharg: false,
    tripleWhale: false, gorgias: false, woocommerce: false, magento: false,
    bigcommerce: false, attentive: false, yotpo: false, loox: false,
    okendo: false, postscript: false, googleAnalytics: false,
    metaPixel: false, tiktokPixel: false, detected: [], confidence: 'low',
  }

  if (!websiteHtml) return result

  for (const tech of TECH_PATTERNS) {
    const found = tech.signals.some(sig =>
      websiteHtml.includes(sig)
    )
    if (found) {
      ;(result[tech.key] as boolean) = true
      result.detected.push(tech.name)
    }
  }

  // Infer Shopify Plus (paid plan signals)
  if (result.shopify && websiteHtml.includes('checkout.shopify.com')) {
    result.shopifyPlus = true
  }

  // Set confidence based on how much we detected
  const highConfidenceKeys = ['shopify', 'shopifyPlus', 'woocommerce', 'magento', 'bigcommerce']
  if (highConfidenceKeys.some(k => result[k as keyof TechStack] === true)) {
    result.confidence = 'high'
  } else if (result.detected.length >= 2) {
    result.confidence = 'medium'
  }

  return result
}

/**
 * Compute a "tech stack score" for the scoring agent
 * Higher = more scalable, more invested brand, better prospect
 */
export function scoreTechStack(tech: TechStack): number {
  let score = 0

  // Commerce platform (max 4 points)
  if (tech.shopifyPlus)  score += 4
  else if (tech.shopify) score += 3
  else if (tech.woocommerce || tech.bigcommerce) score += 2
  else if (tech.magento) score += 1

  // Marketing sophistication (max 3 points)
  if (tech.klaviyo)    score += 1.5
  if (tech.attentive || tech.postscript) score += 1  // SMS = scale
  if (tech.metaPixel)  score += 0.5
  if (tech.tiktokPixel) score += 0.5

  // Revenue / operational signals (max 2 points)
  if (tech.recharg)     score += 1.5  // subscription = recurring revenue
  if (tech.tripleWhale) score += 1    // media buying = growth stage
  if (tech.gorgias)     score += 0.5  // customer support = scale

  // Social proof / review focus (max 1 point)
  if (tech.yotpo || tech.loox || tech.okendo) score += 0.5

  // Normalize to 0-10
  return Math.min(10, Math.round(score * 10) / 10)
}

/**
 * Human-readable tech summary for outreach personalization
 */
export function techSummary(tech: TechStack): string {
  const parts: string[] = []
  if (tech.shopifyPlus)  parts.push('Shopify Plus store')
  else if (tech.shopify) parts.push('Shopify store')
  if (tech.klaviyo)      parts.push('Klaviyo email')
  if (tech.recharg)      parts.push('subscription products')
  if (tech.tiktokPixel)  parts.push('TikTok ads')
  if (tech.tripleWhale)  parts.push('scaling paid media')
  if (tech.gorgias)      parts.push('professional CS setup')
  return parts.join(', ')
}
