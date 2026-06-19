import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createServiceClient as createClient } from '@/lib/supabase/server'
import { setDealStage, setDealNextAction, updateDeal } from '@/actions/deals'
import { TimelineFeed, type EventRow } from '@/components/conversion/timeline-feed'
import { STAGE_ORDER, STAGE_LABELS, LOST_REASONS, LOST_REASON_LABELS, type DealStage } from '@/lib/deals/stage'

const inputCls = 'mt-1 px-2 py-1.5 text-sm border rounded-md bg-background w-full'
const dt = (v?: string | null) => (v ? new Date(v).toISOString().slice(0, 16) : '')   // for datetime-local
const ALL_STAGES = [...STAGE_ORDER, 'lost'] as DealStage[]

export default async function DealPage({ params, searchParams }: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ error?: string; created?: string }>
}) {
  const { id } = await params
  const { error } = await searchParams
  const sb = await createClient()

  const { data: deal } = await sb.from('deals').select('*, companies(id, name)').eq('id', id).single()
  if (!deal) notFound()
  const company = (Array.isArray(deal.companies) ? deal.companies[0] : deal.companies) as { id: string; name: string } | null

  const [{ data: contacts }, { data: events }] = await Promise.all([
    sb.from('contacts').select('id, full_name, title').eq('company_id', company?.id ?? '').order('contact_priority', { ascending: false }),
    sb.from('customer_events').select('id, deal_id, event_type, direction, occurred_at, title, body, owner, source').eq('deal_id', id).order('occurred_at', { ascending: false }).limit(80),
  ])
  const contactName = (cid: string | null) => (contacts ?? []).find((c) => c.id === cid)?.full_name ?? (cid ? '—' : '—')
  const stage = deal.stage as DealStage
  const daysInStage = deal.stage_entered_at ? Math.floor((Date.now() - new Date(deal.stage_entered_at as string).getTime()) / 86_400_000) : null

  return (
    <div className="p-6 max-w-3xl space-y-5">
      {company && <Link href={`/companies/${company.id}`} className="text-xs text-muted-foreground hover:underline">← {company.name}</Link>}
      <div className="flex items-center gap-3 flex-wrap">
        <h1 className="text-xl font-bold">{deal.title as string}</h1>
        <span className="text-xs px-2 py-0.5 rounded-full bg-accent">{STAGE_LABELS[stage]}</span>
        <span className="text-xs px-2 py-0.5 rounded-full border">{deal.status as string}</span>
        {daysInStage != null && deal.status === 'open' && <span className="text-xs text-muted-foreground">停留 {daysInStage} 天</span>}
      </div>

      {error && <div className="rounded-md border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>}

      {/* 阶段进度 */}
      <div className="flex flex-wrap gap-1 text-[11px]">
        {STAGE_ORDER.map((s) => (
          <span key={s} className={`px-2 py-1 rounded ${s === stage ? 'bg-foreground text-background font-medium' : 'bg-muted text-muted-foreground'}`}>{STAGE_LABELS[s]}</span>
        ))}
        {stage === 'lost' && <span className="px-2 py-1 rounded bg-red-100 text-red-700 font-medium">Lost</span>}
      </div>

      {/* 关键信息 */}
      <div className="grid grid-cols-2 gap-3 text-sm border rounded-lg p-4">
        <div><span className="text-muted-foreground text-xs">负责人</span><div>{(deal.owner as string) ?? '未分配'}</div></div>
        <div><span className="text-muted-foreground text-xs">预估金额</span><div>{deal.est_value_usd != null ? `$${Number(deal.est_value_usd).toLocaleString()}` : '—'} · 赢率 {deal.win_prob ?? '—'}%</div></div>
        <div><span className="text-muted-foreground text-xs">预计成交</span><div>{deal.expected_close_date ? new Date(deal.expected_close_date as string).toLocaleDateString() : '—'}</div></div>
        <div><span className="text-muted-foreground text-xs">品类/数量</span><div>{(deal.product_category as string) ?? '—'}{deal.qty ? ` × ${deal.qty}` : ''}</div></div>
        <div><span className="text-muted-foreground text-xs">Champion</span><div>{contactName(deal.champion_contact_id as string | null)}</div></div>
        <div><span className="text-muted-foreground text-xs">Decision Maker</span><div>{contactName(deal.decision_maker_contact_id as string | null)}</div></div>
        <div className="col-span-2"><span className="text-muted-foreground text-xs">下一步</span>
          <div className={deal.next_action_due_at && new Date(deal.next_action_due_at as string).getTime() < Date.now() ? 'text-red-600' : ''}>
            {(deal.next_action as string) ?? '—'}{deal.next_action_due_at ? ` · ${new Date(deal.next_action_due_at as string).toLocaleDateString()}` : ''}
          </div>
        </div>
        {deal.lost_reason && <div className="col-span-2 text-red-700"><span className="text-muted-foreground text-xs">流失原因</span><div>{LOST_REASON_LABELS[deal.lost_reason as keyof typeof LOST_REASON_LABELS] ?? deal.lost_reason as string}</div></div>}
        {deal.annual_potential_usd != null && <div className="col-span-2"><span className="text-muted-foreground text-xs">预计年采购额</span><div>${Number(deal.annual_potential_usd).toLocaleString()}</div></div>}
      </div>

      {/* 阶段操作（门控：Replied 起需 Owner+下一步+到期；Won 需年采购额；Lost 需原因）*/}
      <form action={setDealStage} className="border rounded-lg p-4 space-y-3">
        <h2 className="text-sm font-semibold">推进 / 调整阶段</h2>
        <input type="hidden" name="dealId" value={id} />
        <div className="grid grid-cols-2 gap-3">
          <label className="text-xs text-muted-foreground">目标阶段
            <select name="stage" defaultValue={stage} className={inputCls}>
              {ALL_STAGES.map((s) => <option key={s} value={s}>{STAGE_LABELS[s]}</option>)}
            </select>
          </label>
          <label className="text-xs text-muted-foreground">负责人 Owner
            <input name="owner" defaultValue={(deal.owner as string) ?? ''} className={inputCls} placeholder="alex@…" />
          </label>
          <label className="text-xs text-muted-foreground col-span-2">下一步 Next Action（Replied 起必填）
            <input name="next_action" defaultValue={(deal.next_action as string) ?? ''} className={inputCls} />
          </label>
          <label className="text-xs text-muted-foreground">到期 Due（Replied 起必填）
            <input type="datetime-local" name="next_action_due_at" defaultValue={dt(deal.next_action_due_at as string | null)} className={inputCls} />
          </label>
          <label className="text-xs text-muted-foreground">预计年采购额（标 Won 必填）
            <input type="number" name="annual_potential_usd" defaultValue={deal.annual_potential_usd != null ? String(deal.annual_potential_usd) : ''} className={inputCls} placeholder="USD" />
          </label>
          <label className="text-xs text-muted-foreground col-span-2">流失原因（标 Lost 必填）
            <select name="lost_reason" defaultValue={(deal.lost_reason as string) ?? ''} className={inputCls}>
              <option value="">—</option>
              {LOST_REASONS.map((r) => <option key={r} value={r}>{LOST_REASON_LABELS[r]}</option>)}
            </select>
          </label>
        </div>
        <button className="text-sm px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90">保存阶段</button>
      </form>

      {/* 经济信息 / 角色 */}
      <form action={updateDeal} className="border rounded-lg p-4 space-y-3">
        <h2 className="text-sm font-semibold">机会信息</h2>
        <input type="hidden" name="dealId" value={id} />
        <div className="grid grid-cols-2 gap-3">
          <label className="text-xs text-muted-foreground col-span-2">标题<input name="title" defaultValue={deal.title as string} className={inputCls} /></label>
          <label className="text-xs text-muted-foreground">预估金额 USD<input type="number" name="est_value_usd" defaultValue={deal.est_value_usd != null ? String(deal.est_value_usd) : ''} className={inputCls} /></label>
          <label className="text-xs text-muted-foreground">赢率 %<input type="number" name="win_prob" defaultValue={deal.win_prob != null ? String(deal.win_prob) : ''} className={inputCls} /></label>
          <label className="text-xs text-muted-foreground">预计成交日<input type="date" name="expected_close_date" defaultValue={deal.expected_close_date ? String(deal.expected_close_date).slice(0, 10) : ''} className={inputCls} /></label>
          <label className="text-xs text-muted-foreground">品类<input name="product_category" defaultValue={(deal.product_category as string) ?? ''} className={inputCls} /></label>
          <label className="text-xs text-muted-foreground">数量<input type="number" name="qty" defaultValue={deal.qty != null ? String(deal.qty) : ''} className={inputCls} /></label>
          <label className="text-xs text-muted-foreground">Champion
            <select name="champion_contact_id" defaultValue={(deal.champion_contact_id as string) ?? ''} className={inputCls}>
              <option value="">—</option>
              {(contacts ?? []).map((c) => <option key={c.id} value={c.id}>{c.full_name ?? c.id}</option>)}
            </select>
          </label>
          <label className="text-xs text-muted-foreground">Decision Maker
            <select name="decision_maker_contact_id" defaultValue={(deal.decision_maker_contact_id as string) ?? ''} className={inputCls}>
              <option value="">—</option>
              {(contacts ?? []).map((c) => <option key={c.id} value={c.id}>{c.full_name ?? c.id}</option>)}
            </select>
          </label>
        </div>
        <button className="text-sm px-4 py-2 border rounded-md hover:bg-accent">保存信息</button>
      </form>

      {/* 本机会时间线 */}
      <div className="border rounded-lg p-4">
        <h2 className="text-sm font-semibold mb-2">机会时间线</h2>
        <TimelineFeed
          events={(events ?? []) as EventRow[]}
          companyId={company?.id ?? ''}
          deals={[{ id, title: deal.title as string }]}
          contacts={(contacts ?? []).map((c) => ({ id: c.id as string, full_name: c.full_name as string | null }))}
        />
      </div>
    </div>
  )
}
