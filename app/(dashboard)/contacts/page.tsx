import { createServiceClient as createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { Card, CardContent } from '@/components/ui/card'
import { decodeHtml } from '@/lib/bd/shared'

export const dynamic = 'force-dynamic'

type SP = { q?: string; rel?: string }

export default async function ContactsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const p = await searchParams
  const sb = await createClient()

  let query = sb.from('contacts')
    .select('id, company_id, full_name, title, email, phone, whatsapp, linkedin_url, email_verified, email_deliverable, contact_priority, companies(name, customer_tier)')
    .order('contact_priority', { ascending: false })
    .limit(300)
  if (p.rel === 'verified') query = query.eq('email_verified', true)
  if (p.rel === 'bad') query = query.eq('email_deliverable', false)

  let { data: contacts } = await query
  contacts = contacts ?? []
  if (p.q) {
    const q = p.q.toLowerCase()
    contacts = contacts.filter((c) =>
      [c.full_name, c.title, c.email].some((v) => v && String(v).toLowerCase().includes(q)))
  }

  const one = (v: unknown) => (Array.isArray(v) ? v[0] : v) as { name?: string; customer_tier?: string } | null
  const FILTERS = [
    { key: '', label: '全部', qs: '' },
    { key: 'verified', label: '邮箱已验证', qs: 'rel=verified' },
    { key: 'bad', label: '邮箱不可达', qs: 'rel=bad' },
  ]

  return (
    <div className="p-6 max-w-6xl">
      <div className="mb-4">
        <h1 className="text-2xl font-bold">联系人</h1>
        <p className="text-sm text-muted-foreground mt-1">{contacts.length} 位联系人</p>
      </div>

      <div className="flex gap-2 mb-4 flex-wrap">
        {FILTERS.map((f) => (
          <Link key={f.label} href={f.qs ? `/contacts?${f.qs}` : '/contacts'}
            className={`px-3 py-1 rounded-full text-xs border ${(p.rel ?? '') === f.key ? 'bg-foreground text-background border-foreground' : 'border-border text-muted-foreground hover:border-foreground'}`}>
            {f.label}
          </Link>
        ))}
      </div>

      {contacts.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">
          暂无联系人。去客户页用「富集 / Apollo / 查国内联系方式」补全。
        </CardContent></Card>
      ) : (
        <div className="rounded-md border overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 border-b text-muted-foreground">
              <tr>{['姓名', '职位', '客户', '级别', '邮箱', '电话/微信', '状态'].map((h) => (
                <th key={h} className="text-left px-3 py-2 font-medium whitespace-nowrap">{h}</th>
              ))}</tr>
            </thead>
            <tbody className="divide-y">
              {contacts.map((c) => {
                const co = one(c.companies)
                const bad = c.email_deliverable === false
                return (
                  <tr key={c.id} className="hover:bg-muted/30">
                    <td className="px-3 py-2 font-medium">{c.full_name ?? '（仅职位）'}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{c.title ?? '—'}</td>
                    <td className="px-3 py-2">{c.company_id
                      ? <Link href={`/companies/${c.company_id}`} className="text-blue-600 hover:underline">{decodeHtml(co?.name ?? '客户')}</Link>
                      : '—'}</td>
                    <td className="px-3 py-2 text-xs">{co?.customer_tier ?? '—'}</td>
                    <td className="px-3 py-2 text-xs">{c.email
                      ? <span className={bad ? 'text-red-600 line-through' : ''}>{c.email}</span>
                      : <span className="text-amber-600">无</span>}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{[c.phone, c.whatsapp].filter(Boolean).join(' / ') || '—'}</td>
                    <td className="px-3 py-2 text-xs">{c.email_verified
                      ? <span className="text-green-600">✓已验证</span>
                      : bad ? <span className="text-red-600">✗不可达</span> : <span className="text-amber-600">未验证</span>}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
