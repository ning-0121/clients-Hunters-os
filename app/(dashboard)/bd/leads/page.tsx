import { createServiceClient as createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { decodeHtml, TIER_STYLES, SEGMENT_LABELS } from '@/lib/bd/shared'
import { FACTORY_TYPE_LABELS, COMPLIANCE_LABELS, type RecommendedFactoryType, type ComplianceLevel } from '@/lib/tiering/tiering'
import { assignLeadToMe, rejectLead } from '@/actions/bd'
import { generateReport, createOutreachDraftFromReport } from '@/actions/reports'

export const dynamic = 'force-dynamic'

const FILTERS: { key: string; label: string; qs: string }[] = [
  { key: 'tier=B', label: 'B 级目标', qs: 'tier=B' },
  { key: 'tier=A', label: 'A 级战略', qs: 'tier=A' },
  { key: 'tier=C', label: 'C 级快测', qs: 'tier=C' },
  { key: 'segment=domestic_trading_company', label: '国内外贸公司', qs: 'segment=domestic_trading_company' },
  { key: 'domestic_type=software_prospect', label: '软件客户', qs: 'domestic_type=software_prospect' },
  { key: 'segment=overseas_brand', label: '海外品牌', qs: 'segment=overseas_brand' },
  { key: 'segment=overseas_importer', label: '海外进口商', qs: 'segment=overseas_importer' },
  { key: 'compliance=sedex_smeta', label: '需要 SMETA', qs: 'compliance=sedex_smeta' },
  { key: 'factory=current', label: '现工厂可做', qs: 'factory=current' },
  { key: 'factory=partner_smeta', label: '需合作工厂', qs: 'factory=partner_smeta' },
  { key: 'rel=email_verified', label: '邮箱已验证', qs: 'rel=email_verified' },
  { key: 'rel=has_contact', label: '有联系人', qs: 'rel=has_contact' },
  { key: 'rel=has_report', label: '已有报告', qs: 'rel=has_report' },
  { key: 'rel=no_outreach', label: '尚未触达', qs: 'rel=no_outreach' },
  { key: 'rel=replied', label: '已回复', qs: 'rel=replied' },
]

type SP = { tier?: string; segment?: string; domestic_type?: string; compliance?: string; factory?: string; rel?: string }

export default async function BdLeadsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const p = await searchParams
  const sb = await createClient()
  const active = p.tier ? `tier=${p.tier}` : p.segment ? `segment=${p.segment}`
    : p.domestic_type ? `domestic_type=${p.domestic_type}` : p.compliance ? `compliance=${p.compliance}`
    : p.factory ? `factory=${p.factory}` : p.rel ? `rel=${p.rel}` : ''

  let q = sb.from('companies')
    .select('id, name, country, region, customer_tier, target_customer_segment, domestic_company_type, product_match, recommended_development_strategy, compliance_level, recommended_factory_type, next_action, assigned_to, status')
    .neq('status', 'closed_lost').order('total_score', { ascending: false }).limit(120)

  if (p.tier) q = q.eq('customer_tier', p.tier)
  if (p.segment) q = q.eq('target_customer_segment', p.segment)
  if (p.domestic_type) q = q.eq('domestic_company_type', p.domestic_type)
  if (p.compliance) q = q.eq('compliance_level', p.compliance)
  if (p.factory === 'current') q = q.in('recommended_factory_type', ['current', 'current_after_renewal'])
  else if (p.factory) q = q.eq('recommended_factory_type', p.factory)

  let { data: companies } = await q
  companies = companies ?? []

  // Relational filters / status badges — fetch id-sets once.
  const ids = companies.map((c) => c.id)
  const [contactsRes, repliesRes, outreachRes, reportsRes] = await Promise.all([
    sb.from('contacts').select('company_id, email_verified, email').in('company_id', ids),
    sb.from('reply_events').select('company_id').in('company_id', ids),
    sb.from('outreach_logs').select('company_id').in('company_id', ids),
    sb.from('customer_intelligence_reports').select('company_id').in('company_id', ids),
  ])
  const hasContact = new Set<string>(), emailVerified = new Set<string>(), replied = new Set<string>(),
    hasOutreach = new Set<string>(), hasReport = new Set<string>()
  for (const c of contactsRes.data ?? []) { if (c.company_id) { hasContact.add(c.company_id); if (c.email_verified || c.email) emailVerified.add(c.company_id) } }
  for (const r of repliesRes.data ?? []) if (r.company_id) replied.add(r.company_id)
  for (const o of outreachRes.data ?? []) if (o.company_id) hasOutreach.add(o.company_id)
  for (const r of reportsRes.data ?? []) if (r.company_id) hasReport.add(r.company_id)

  if (p.rel === 'has_contact') companies = companies.filter((c) => hasContact.has(c.id))
  if (p.rel === 'email_verified') companies = companies.filter((c) => emailVerified.has(c.id))
  if (p.rel === 'has_report') companies = companies.filter((c) => hasReport.has(c.id))
  if (p.rel === 'no_outreach') companies = companies.filter((c) => !hasOutreach.has(c.id))
  if (p.rel === 'replied') companies = companies.filter((c) => replied.has(c.id))

  const productAngle = (c: { product_match?: unknown; recommended_development_strategy?: string }) => {
    if (Array.isArray(c.product_match) && c.product_match.length) {
      const pm = c.product_match[0] as { category?: string; level?: string }
      return `${pm.category ?? ''}${pm.level ? ` (${pm.level})` : ''}`
    }
    return c.recommended_development_strategy ?? '—'
  }

  return (
    <div className="p-6 max-w-7xl">
      <div className="flex items-center justify-between mb-4">
        <div><h1 className="text-2xl font-bold">客户池</h1><p className="text-sm text-muted-foreground mt-1">{companies.length} 个客户</p></div>
        <Link href="/leads/discovery" className="text-sm px-4 py-2 bg-primary text-primary-foreground rounded-md">+ Discovery</Link>
      </div>

      <div className="flex gap-2 mb-4 flex-wrap">
        <Link href="/bd/leads" className={`px-3 py-1 rounded-full text-xs border ${!active ? 'bg-foreground text-background' : 'text-muted-foreground hover:border-foreground'}`}>全部</Link>
        {FILTERS.map((f) => (
          <Link key={f.key} href={`/bd/leads?${f.qs}`} className={`px-3 py-1 rounded-full text-xs border ${active === f.key ? 'bg-foreground text-background border-foreground' : 'border-border text-muted-foreground hover:border-foreground'}`}>{f.label}</Link>
        ))}
      </div>

      {companies.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">
          没有符合条件的客户。<Link href="/leads/discovery" className="text-primary hover:underline">运行 Discovery 补充线索 →</Link>
        </CardContent></Card>
      ) : (
        <div className="rounded-md border overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 border-b text-muted-foreground">
              <tr>
                {['客户', '国家/地区', '类型', '级别', '产品匹配', '合规', '工厂', '联系/邮箱', '下一步', '负责人', '操作'].map((h) => (
                  <th key={h} className="text-left px-3 py-2 font-medium whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {companies.map((c) => (
                <tr key={c.id} className="hover:bg-muted/30 align-top">
                  <td className="px-3 py-2"><Link href={`/companies/${c.id}`} className="font-medium hover:underline">{decodeHtml(c.name)}</Link></td>
                  <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">{c.country ?? c.region ?? '—'}</td>
                  <td className="px-3 py-2">{c.target_customer_segment && <Badge variant="outline" className="text-[10px]">{SEGMENT_LABELS[c.target_customer_segment] ?? c.target_customer_segment}</Badge>}</td>
                  <td className="px-3 py-2">{c.customer_tier && <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${TIER_STYLES[c.customer_tier]}`}>{c.customer_tier}</span>}</td>
                  <td className="px-3 py-2 text-xs">{productAngle(c)}</td>
                  <td className="px-3 py-2 text-xs">{c.compliance_level ? (COMPLIANCE_LABELS[c.compliance_level as ComplianceLevel] ?? c.compliance_level) : '—'}</td>
                  <td className="px-3 py-2 text-xs">{c.recommended_factory_type ? (FACTORY_TYPE_LABELS[c.recommended_factory_type as RecommendedFactoryType] ?? c.recommended_factory_type) : '—'}</td>
                  <td className="px-3 py-2 text-xs">{emailVerified.has(c.id) ? '✓ 邮箱' : hasContact.has(c.id) ? '联系人' : '—'}{replied.has(c.id) ? ' · 已回复' : ''}</td>
                  <td className="px-3 py-2 text-xs max-w-[200px]">{c.next_action ?? '—'}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{c.assigned_to ?? '未分配'}</td>
                  <td className="px-3 py-2">
                    <div className="flex gap-1 flex-wrap">
                      <Link href={`/companies/${c.id}/report`} className="text-[11px] px-2 py-1 border rounded">报告</Link>
                      {hasReport.has(c.id)
                        ? <form action={createOutreachDraftFromReport}><input type="hidden" name="companyId" value={c.id} /><button className="text-[11px] px-2 py-1 border rounded">开发信</button></form>
                        : <form action={generateReport}><input type="hidden" name="companyId" value={c.id} /><button className="text-[11px] px-2 py-1 border rounded">生成报告</button></form>}
                      <form action={assignLeadToMe}><input type="hidden" name="companyId" value={c.id} /><button className="text-[11px] px-2 py-1 border rounded">领取</button></form>
                      <form action={rejectLead}><input type="hidden" name="companyId" value={c.id} /><button className="text-[11px] px-2 py-1 border rounded text-muted-foreground">放弃</button></form>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
