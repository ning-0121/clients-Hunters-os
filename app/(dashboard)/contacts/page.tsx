import { createServiceClient as createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { decodeHtml } from '@/lib/bd/shared'
import { computeCredibility, credibilityRank } from '@/lib/contacts/credibility'
import { classifyRole, ROLE_LABELS, roleRank, type ContactRole } from '@/lib/contacts/roles'
import { computeIntent, INTENT_BADGE } from '@/lib/intent/intent'

export const dynamic = 'force-dynamic'

type SP = { role?: string; cred?: string; intent?: string; status?: string }

export default async function ContactsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const p = await searchParams
  const sb = await createClient()

  const { data: rawContacts } = await sb.from('contacts')
    .select('id, company_id, full_name, title, email, phone, whatsapp, linkedin_url, email_verified, email_deliverable, email_confidence, email_source, status, contact_priority, companies(name, customer_tier, status, hiring_signal, hiring_roles, recruitment_signals, management_pain_signals, new_products_detected, funding_detected, trigger_type, trigger_detail)')
    .order('contact_priority', { ascending: false })
    .limit(500)

  const one = (v: unknown) => (Array.isArray(v) ? v[0] : v) as Record<string, unknown> | null

  // Enrich each contact with role / credibility / intent (computed, zero-cost).
  let rows = (rawContacts ?? []).map((c) => {
    const co = one(c.companies)
    const role = classifyRole(c.title) as ContactRole
    const cred = computeCredibility(c)
    const intent = computeIntent({
      hiring_signal: co?.hiring_signal as boolean, hiring_roles: co?.hiring_roles as string[],
      recruitment_signals: co?.recruitment_signals as string[], management_pain_signals: co?.management_pain_signals as string[],
      new_products_detected: co?.new_products_detected as boolean, funding_detected: co?.funding_detected as boolean,
      trigger_type: co?.trigger_type as string, trigger_detail: co?.trigger_detail as string, status: co?.status as string,
    })
    return { c, co, role, cred, intent }
  })

  // Filters
  if (p.role) rows = rows.filter((r) => r.role === p.role)
  if (p.cred) rows = rows.filter((r) => r.cred.tier === p.cred)
  if (p.intent) rows = rows.filter((r) => r.intent.level === p.intent)
  if (p.status) rows = rows.filter((r) => (r.c.status ?? 'uncontacted') === p.status)

  // Sort: intent → credibility → role → tier — "who's most worth contacting now"
  const tierW = (t?: string) => (t === 'A' ? 3 : t === 'B' ? 2 : t === 'C' ? 1 : 0)
  rows.sort((a, b) =>
    b.intent.score - a.intent.score ||
    credibilityRank(b.cred.tier) - credibilityRank(a.cred.tier) ||
    roleRank(b.role) - roleRank(a.role) ||
    tierW(b.co?.customer_tier as string) - tierW(a.co?.customer_tier as string))

  const ROLE_FILTERS: ContactRole[] = ['founder', 'sourcing', 'product', 'production', 'operations']
  const chip = (active: boolean) => `px-3 py-1 rounded-full text-xs border ${active ? 'bg-foreground text-background border-foreground' : 'border-border text-muted-foreground hover:border-foreground'}`
  const qs = (patch: Partial<SP>) => {
    const merged = { ...p, ...patch }
    const s = Object.entries(merged).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join('&')
    return s ? `/contacts?${s}` : '/contacts'
  }

  return (
    <div className="p-6 max-w-7xl">
      <div className="mb-4">
        <h1 className="text-2xl font-bold">联系人中心</h1>
        <p className="text-sm text-muted-foreground mt-1">{rows.length} 位联系人 · 按「采购意图 → 邮箱可信度 → 角色」排序，知道先联系谁</p>
      </div>

      {/* Filters */}
      <div className="space-y-2 mb-4">
        <div className="flex gap-2 flex-wrap items-center">
          <span className="text-[11px] text-muted-foreground w-12">角色</span>
          <Link href={qs({ role: undefined })} className={chip(!p.role)}>全部</Link>
          {ROLE_FILTERS.map((r) => <Link key={r} href={qs({ role: r })} className={chip(p.role === r)}>{ROLE_LABELS[r]}</Link>)}
        </div>
        <div className="flex gap-2 flex-wrap items-center">
          <span className="text-[11px] text-muted-foreground w-12">可信度</span>
          <Link href={qs({ cred: undefined })} className={chip(!p.cred)}>全部</Link>
          <Link href={qs({ cred: 'verified' })} className={chip(p.cred === 'verified')}>✓ Verified</Link>
          <Link href={qs({ cred: 'trusted' })} className={chip(p.cred === 'trusted')}>◆ Trusted</Link>
          <Link href={qs({ cred: 'probable' })} className={chip(p.cred === 'probable')}>~ Probable</Link>
          <Link href={qs({ cred: 'guessed' })} className={chip(p.cred === 'guessed')}>? Guessed</Link>
        </div>
        <div className="flex gap-2 flex-wrap items-center">
          <span className="text-[11px] text-muted-foreground w-12">意图</span>
          <Link href={qs({ intent: undefined })} className={chip(!p.intent)}>全部</Link>
          <Link href={qs({ intent: 'hot' })} className={chip(p.intent === 'hot')}>🔥 高意图</Link>
          <Link href={qs({ intent: 'warm' })} className={chip(p.intent === 'warm')}>🟡 中意图</Link>
        </div>
      </div>

      {rows.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">
          没有符合条件的联系人。去客户页用「富集 / Apollo / 查国内联系方式」补全。
        </CardContent></Card>
      ) : (
        <div className="rounded-md border overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 border-b text-muted-foreground">
              <tr>{['联系人', '角色', '客户', '意图', '邮箱', '可信度', '其他渠道', '操作'].map((h) => (
                <th key={h} className="text-left px-3 py-2 font-medium whitespace-nowrap">{h}</th>
              ))}</tr>
            </thead>
            <tbody className="divide-y">
              {rows.map(({ c, co, role, cred, intent }) => (
                <tr key={c.id} className="hover:bg-muted/30 align-top">
                  <td className="px-3 py-2">
                    <div className="font-medium">{(c.full_name as string) || '（仅职位）'}</div>
                    <div className="text-[11px] text-muted-foreground">{c.title ?? ''}</div>
                  </td>
                  <td className="px-3 py-2"><Badge variant="outline" className="text-[10px]">{ROLE_LABELS[role]}</Badge></td>
                  <td className="px-3 py-2">{c.company_id
                    ? <Link href={`/companies/${c.company_id}`} className="text-blue-600 hover:underline">{decodeHtml((co?.name as string) ?? '客户')}</Link>
                    : '—'}{co?.customer_tier ? <span className="text-[10px] ml-1 text-muted-foreground">{co.customer_tier as string}</span> : ''}</td>
                  <td className="px-3 py-2"><span className={`text-[10px] px-1.5 py-0.5 rounded-full ${INTENT_BADGE[intent.level].cls}`} title={intent.reason}>{intent.score}</span></td>
                  <td className="px-3 py-2 text-xs">{c.email
                    ? <span className={cred.tier === 'guessed' && c.email_deliverable === false ? 'line-through text-muted-foreground' : ''}>{c.email as string}</span>
                    : <span className="text-amber-600">无</span>}</td>
                  <td className="px-3 py-2"><span className={`text-[10px] px-1.5 py-0.5 rounded ${cred.badgeClass}`} title={`${cred.sourceLabel} · ${cred.statusLabel}`}>{cred.tierLabel}</span></td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {[c.phone, c.whatsapp].filter(Boolean).join(' / ') || (c.linkedin_url ? '' : '—')}
                    {c.linkedin_url ? <a href={c.linkedin_url as string} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline ml-1">LinkedIn</a> : null}
                  </td>
                  <td className="px-3 py-2">{c.company_id && <Link href={`/companies/${c.company_id}/outreach`} className="text-[11px] px-2 py-1 border rounded-md">开发信</Link>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
