'use server'

import { createServiceClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { assessCredit, parseShipments } from '@/lib/credit/assess'
import { getBdIdentity } from '@/lib/bd/shared'
import { getAppConfig, salesFocusDirective, OUTREACH_TONE_LABELS } from '@/lib/config'
import { getPricingBaseline, type QuoteCategory, type FabricComplexity, type FabricMaterial, QUOTE_CATEGORIES } from '@/lib/quote/pricing-config'
import { computeQuoteStrategy, type QuoteEngineInput, type QuoteStrategy, type CompetitionLevel, type CompetitionMeta } from '@/lib/quote/engine'
import { inferCompetition } from '@/lib/quote/competition'
import { composeQuoteMessage } from '@/lib/quote/message'
import { logEvent } from '@/lib/events/log'

const LATAM = ['Mexico', 'Colombia', 'Brazil', 'Argentina', 'Peru', 'Chile', 'Venezuela']

type Row = Record<string, unknown>

const asNum = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : v != null && !Number.isNaN(Number(v)) ? Number(v) : null)

/** Assemble engine inputs from DB rows (credit reused from lib/credit/assess). */
function buildEngineInput(
  company: Row,
  score: Row | null,
  contacts: Row[],
  samples: Row[],
  orders: Row[],
  product: { category: QuoteCategory; qty: number; fabricComplexity: FabricComplexity; fabricMaterial?: FabricMaterial | null; plusSize?: boolean | null },
  competition: { level: CompetitionLevel | null; isPriceComparing: boolean | null; meta: CompetitionMeta },
): QuoteEngineInput {
  // Grounded credit/payment risk — same inputs the customer page uses.
  const customs = (company.source_raw as Row | null)?.customs as { snippets?: string[] } | undefined
  const credit = assessCredit({
    customsShipments: parseShipments((customs?.snippets ?? []).join(' ')),
    hasCustomsHistory: !!(customs?.snippets?.length) || ((company.current_supplier_hints as unknown[] | null)?.length ?? 0) > 0,
    employeeRange: (company.employee_count_range as string) ?? null,
    fundingDetected: !!company.funding_detected,
    foundedYear: (company.founded_year as number) ?? null,
    country: (company.country as string) ?? null,
    estRevenue: (company.estimated_annual_revenue as string) ?? null,
    pricePoint: (company.price_point as string) ?? null,
  })

  // Anti-freeloader: samples requested but never converted to an order.
  const orderCount = orders.length
  const hasRepeatOrder = orders.some((o) => o.is_repeat === true)
  const sampleCount = samples.length
  // No order at all → every sample is unconverted; otherwise count explicit rejections.
  const unconvertedSampleCount = orderCount === 0
    ? sampleCount
    : samples.filter((s) => String(s.status ?? '') === 'rejected').length

  // Contact quality proxy: a verified/deliverable email on a real contact.
  const contactQualityScore = contacts.some((c) => c.email_verified === true || c.email_deliverable === true)
    ? 8
    : contacts.some((c) => !!c.email) ? 5 : 2

  return {
    qty: product.qty,
    fabricComplexity: product.fabricComplexity,
    fabricMaterial: product.fabricMaterial ?? null,
    plusSize: product.plusSize ?? null,
    customerTier: (company.customer_tier as QuoteEngineInput['customerTier']) ?? null,
    intentScore: asNum(company.intent_score),
    productMatchScore: asNum(company.product_match_score),
    customerScaleScore: asNum(company.customer_scale_score),
    ltvPotentialScore: asNum(score?.ltv_potential_score) ?? asNum(company.ltv_potential_score),
    replyProbabilityScore: asNum(score?.reply_probability_score),
    contactQualityScore,
    estimatedAnnualRevenue: (company.estimated_annual_revenue as string) ?? null,
    targetCustomerSegment: (company.target_customer_segment as string) ?? null,
    country: (company.country as string) ?? null,
    instagramFollowers: asNum(company.instagram_followers),
    tiktokFollowers: asNum(company.tiktok_followers),
    fundingDetected: !!company.funding_detected,
    newProductsDetected: !!company.new_products_detected,
    isPriceComparing: competition.isPriceComparing,
    competitionLevel: competition.level,
    competitionMeta: competition.meta,
    orderCount,
    hasRepeatOrder,
    sampleCount,
    unconvertedSampleCount,
    creditRiskScore: credit.riskScore,
    creditBand: credit.band,
    paymentRiskScore: asNum(company.payment_risk_score),
  }
}

/**
 * Compute (no persistence) the quote strategy for a company — used by the
 * Quote Strategy Card to render synchronously on the customer page.
 */
export async function computeQuoteStrategyForCompany(
  companyId: string,
  product: { category: QuoteCategory; qty: number; fabricComplexity: FabricComplexity; fabricMaterial?: FabricMaterial | null; plusSize?: boolean | null; isPriceComparing?: boolean | null; competitionLevel?: CompetitionLevel | null },
): Promise<QuoteStrategy | null> {
  const supabase = await createServiceClient()
  const [{ data: company }, { data: score }, { data: contacts }, { data: samples }, { data: orders }] = await Promise.all([
    supabase.from('companies').select('*').eq('id', companyId).single(),
    supabase.from('customer_scores').select('*').eq('company_id', companyId).maybeSingle(),
    supabase.from('contacts').select('email, email_verified, email_deliverable').eq('company_id', companyId),
    supabase.from('samples').select('status, created_at').eq('company_id', companyId),
    supabase.from('orders').select('is_repeat, status').eq('company_id', companyId),
  ])
  if (!company) return null
  const co = company as Row

  // Resolve competition: explicit (this form) > stored annotation > inferred from customs.
  const customsSuppliers = ((co.source_raw as Row | null)?.customs as { supplierHints?: string[] } | undefined)?.supplierHints
  const inf = inferCompetition({
    supplierHints: (co.current_supplier_hints as string[] | null) ?? null,
    customsSupplierHints: customsSuppliers ?? null,
    hasCustomsHistory: !!customsSuppliers?.length,
    pricePoint: (co.price_point as string) ?? null,
  })
  const manualLevel = product.competitionLevel ?? null
  const manualPc = product.isPriceComparing ?? null
  const storedLevel = (co.competition_level as CompetitionLevel | null) ?? null
  const storedPc = (co.is_price_comparing as boolean | null) ?? null
  const level = manualLevel ?? storedLevel ?? inf.competitionLevel
  const isPriceComparing = manualPc ?? storedPc ?? inf.isPriceComparing
  const source: CompetitionMeta['source'] =
    manualLevel !== null || manualPc !== null ? 'manual'
    : storedLevel !== null || storedPc !== null ? 'stored'
    : inf.competitionLevel !== null || inf.isPriceComparing !== null ? 'inferred'
    : 'none'
  const note =
    source === 'inferred' ? inf.note
    : source === 'stored' ? '业务员先前标注（已保存）'
    : source === 'manual' ? '本次手动标注'
    : '未标注、且无海关供应商线索可推断'
  const meta: CompetitionMeta = { level, isPriceComparing, source, note }

  const baseline = await getPricingBaseline(product.category)
  const input = buildEngineInput(
    co, (score as Row) ?? null, (contacts as Row[]) ?? [], (samples as Row[]) ?? [], (orders as Row[]) ?? [],
    { category: product.category, qty: product.qty, fabricComplexity: product.fabricComplexity, fabricMaterial: product.fabricMaterial ?? null, plusSize: product.plusSize ?? null },
    { level, isPriceComparing, meta },
  )
  return computeQuoteStrategy(input, baseline)
}

function parseProduct(formData: FormData): { category: QuoteCategory; qty: number; fabricComplexity: FabricComplexity; fabricMaterial: FabricMaterial | null; plusSize: boolean; isPriceComparing: boolean | null; competitionLevel: CompetitionLevel | null } {
  const rawCat = String(formData.get('category') ?? 'leggings')
  const category = (QUOTE_CATEGORIES as string[]).includes(rawCat) ? (rawCat as QuoteCategory) : 'leggings'
  const qty = Math.max(1, Math.round(Number(formData.get('qty')) || 0) || 0) || 100
  const fc = String(formData.get('fabricComplexity') ?? 'medium')
  const fabricComplexity: FabricComplexity = fc === 'low' || fc === 'high' ? fc : 'medium'
  const fmRaw = String(formData.get('fabricMaterial') ?? '')
  const fabricMaterial = (['poly_spandex', 'nylon_spandex', 'cotton', 'fleece', 'seamless'].includes(fmRaw) ? fmRaw : null) as FabricMaterial | null
  const plusSize = formData.get('plusSize') === 'yes'
  const pcRaw = formData.get('isPriceComparing')
  const isPriceComparing = pcRaw === 'yes' ? true : pcRaw === 'no' ? false : null
  const clRaw = String(formData.get('competitionLevel') ?? '')
  const competitionLevel = (['extreme', 'strong', 'normal', 'weak'].includes(clRaw) ? clRaw : null) as CompetitionLevel | null
  return { category, qty, fabricComplexity, fabricMaterial, plusSize, isPriceComparing, competitionLevel }
}

/**
 * Compute + persist a quote-strategy snapshot. If a sub-floor strategic band is
 * unlocked (strategic customer, below normal floor), open an OWNER APPROVAL —
 * the salesperson cannot mark it quotable themselves. Never sends anything.
 */
export async function triggerQuoteStrategy(formData: FormData): Promise<void> {
  const companyId = String(formData.get('companyId') ?? '')
  if (!companyId) return
  const product = parseProduct(formData)
  const supabase = await createServiceClient()
  const identity = await getBdIdentity()

  // Persist the salesperson's competition annotations on the company (sticky).
  const annotate: Row = {}
  if (product.isPriceComparing !== null) annotate.is_price_comparing = product.isPriceComparing
  if (product.competitionLevel !== null) annotate.competition_level = product.competitionLevel
  if (Object.keys(annotate).length) await supabase.from('companies').update(annotate).eq('id', companyId)

  const strategy = await computeQuoteStrategyForCompany(companyId, product)
  if (!strategy) return

  // Owner approval gate — only when the strategic (sub-floor) band is unlocked.
  let approvalId: string | null = null
  if (strategy.requiresOwnerApproval) {
    const { data: company } = await supabase.from('companies').select('name').eq('id', companyId).single()
    const { data: existing } = await supabase
      .from('approvals')
      .select('id')
      .eq('company_id', companyId)
      .eq('approval_type', 'quote_strategic')
      .eq('status', 'pending')
      .maybeSingle()
    if (existing?.id) {
      approvalId = existing.id as string
    } else {
      const { data: appr } = await supabase
        .from('approvals')
        .insert({
          company_id: companyId,
          approval_type: 'quote_strategic',
          approval_level: 'owner',
          title: `战略报价审批：${(company?.name as string) ?? '客户'}（${strategy.categoryLabel}）`,
          description: strategy.strategicNote ?? '低于普通底线的战略报价，需老板审批后方可执行（系统不自动报价/发送）。',
          action_payload: {
            quoteCategory: strategy.category,
            qty: strategy.qty,
            strategicMargin: strategy.margins.strategic,
            floorMargin: strategy.margins.floor,
            recommendedPrice: strategy.prices.recommended,
            strategicPrice: strategy.prices.strategic,
          },
          risk_level: strategy.scores.risk.score >= 60 ? 'high' : strategy.scores.risk.score >= 40 ? 'medium' : 'low',
          risk_reasoning: `战略价值 ${strategy.scores.strategicValue.score} / 风险 ${strategy.scores.risk.score} / 成交概率 ${strategy.scores.winProbability.score}`,
          estimated_value: strategy.prices.recommended * strategy.qty,
          status: 'pending',
          requested_by: identity.who,
        })
        .select('id')
        .single()
      approvalId = (appr?.id as string) ?? null
    }
  }

  await supabase.from('quote_strategies').insert({
    company_id: companyId,
    category: strategy.category,
    qty: strategy.qty,
    fabric_complexity: strategy.fabricComplexity,
    pricing_score: strategy.scores.pricing.score,
    deal_value_score: strategy.scores.dealValue.score,
    win_probability: strategy.scores.winProbability.score,
    risk_score: strategy.scores.risk.score,
    strategic_value_score: strategy.scores.strategicValue.score,
    floor_margin: strategy.margins.floor,
    recommended_margin: strategy.margins.recommended,
    target_margin: strategy.margins.target,
    strategic_margin: strategy.margins.strategic,
    recommended_price: strategy.prices.recommended,
    requires_owner_approval: strategy.requiresOwnerApproval,
    sample_policy: strategy.samplePolicy.policy,
    negotiation_rules: strategy.negotiation,
    explanation: strategy.explanation,
    inputs_snapshot: {
      scores: {
        pricing: strategy.scores.pricing.score,
        dealValue: strategy.scores.dealValue.score,
        winProbability: strategy.scores.winProbability.score,
        risk: strategy.scores.risk.score,
        strategicValue: strategy.scores.strategicValue.score,
      },
      prices: strategy.prices,
      isStrategicCustomer: strategy.isStrategicCustomer,
    },
    cac: null, // RESERVED — not computed in P0
    approval_id: approvalId,
    created_by: identity.who,
    deal_id: String(formData.get('dealId') ?? '') || null,
  })

  await logEvent({
    companyId, dealId: String(formData.get('dealId') ?? '') || null,
    eventType: 'quote', direction: 'internal',
    title: `报价策略快照：${strategy.category} × ${strategy.qty}，推荐 ${(strategy.margins.recommended * 100).toFixed(0)}%`,
    owner: identity.who, refTable: 'quote_strategies',
  })

  revalidatePath(`/companies/${companyId}`)
  if (approvalId) revalidatePath('/approvals')
}

/**
 * P1 #5 — generate a customer-readable quote message (LLM) from the latest
 * snapshot, and store it on that snapshot. The message is a DRAFT for the
 * salesperson to review and copy — it is NEVER auto-sent to the customer.
 */
export async function generateQuoteMessage(formData: FormData): Promise<void> {
  const companyId = String(formData.get('companyId') ?? '')
  const feedback = String(formData.get('feedback') ?? '').trim() || undefined
  if (!companyId) return
  const supabase = await createServiceClient()

  // Needs a computed snapshot first (carries the customer-facing price range).
  const { data: snap } = await supabase
    .from('quote_strategies')
    .select('id, category, qty, inputs_snapshot')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!snap) return

  const [{ data: company }, { data: contact }] = await Promise.all([
    supabase.from('companies').select('name, country').eq('id', companyId).single(),
    supabase.from('contacts').select('full_name, title').eq('company_id', companyId).order('contact_priority', { ascending: false }).limit(1).maybeSingle(),
  ])
  if (!company) return

  const cfg = await getAppConfig()
  const sp = cfg.sellerProfile
  const country = (company.country as string) ?? null
  const autoLang = country === 'Brazil' ? 'pt' : (country && LATAM.includes(country)) ? 'es' : 'en'
  const lang = sp.defaultLang === 'auto' ? autoLang : sp.defaultLang

  const baseline = await getPricingBaseline((snap.category as QuoteCategory) ?? 'leggings')
  const prices = (snap.inputs_snapshot as Row | null)?.prices as { rangeLow?: number; rangeHigh?: number } | undefined

  const msg = await composeQuoteMessage({
    companyName: company.name as string,
    contactName: (contact?.full_name as string) ?? null,
    contactTitle: (contact?.title as string) ?? null,
    country,
    categoryLabel: baseline.label,
    qty: (snap.qty as number) ?? baseline.moq,
    lang,
    mentionPrice: sp.mentionPrice,
    priceLow: prices?.rangeLow ?? null,
    priceHigh: prices?.rangeHigh ?? null,
    mentionMoq: sp.mentionMoq,
    moq: baseline.moq,
    companyIntro: sp.companyIntro,
    sellingPoints: sp.sellingPoints,
    toneLabel: OUTREACH_TONE_LABELS[sp.outreachTone],
    signature: sp.signature,
    ctaPreference: sp.ctaPreference,
    salesFocusDirective: salesFocusDirective(cfg.salesFocus),
  }, feedback)
  if (!msg) return

  await supabase
    .from('quote_strategies')
    .update({ quote_message: msg, quote_message_lang: lang, quote_message_at: new Date().toISOString() })
    .eq('id', snap.id)

  revalidatePath(`/companies/${companyId}`)
}
