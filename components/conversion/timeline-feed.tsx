import { recordInteraction } from '@/actions/deals'
import { EVENT_LABELS, MANUAL_EVENT_TYPES, type EventType } from '@/lib/events/log'

export interface EventRow {
  id: string
  deal_id: string | null
  event_type: EventType
  direction: string | null
  occurred_at: string
  title: string
  body: string | null
  owner: string | null
  source: string | null
}

const ICON: Record<string, string> = {
  email_out: '✉️', email_in: '✉️', whatsapp: '💬', call: '📞', meeting: '🤝', exhibition: '🎪',
  office_visit: '🏢', sample: '📦', quote: '📄', negotiation: '🔁', po: '🧾', payment: '💰',
  complaint: '⚠️', stage_change: '🚩', note: '📝', task: '✅',
}

const inputCls = 'mt-1 px-2 py-1 text-xs border rounded-md bg-background'

export function TimelineFeed({
  events, companyId, deals = [], contacts = [],
}: {
  events: EventRow[]
  companyId: string
  deals?: { id: string; title: string }[]
  contacts?: { id: string; full_name: string | null }[]
}) {
  return (
    <div className="space-y-3">
      {/* 记录互动（离线渠道） */}
      <details className="border rounded-md px-3 py-2">
        <summary className="text-xs text-primary cursor-pointer">＋ 记录互动（WhatsApp / 电话 / 会议 / 拜访 / 展会 / 收款 / 投诉 / 备注）</summary>
        <form action={recordInteraction} className="mt-2 grid grid-cols-2 gap-2">
          <input type="hidden" name="companyId" value={companyId} />
          <label className="text-[11px] text-muted-foreground">渠道
            <select name="event_type" className={`${inputCls} w-full`} required>
              {MANUAL_EVENT_TYPES.map((t) => <option key={t} value={t}>{EVENT_LABELS[t]}</option>)}
            </select>
          </label>
          <label className="text-[11px] text-muted-foreground">方向
            <select name="direction" className={`${inputCls} w-full`} defaultValue="out">
              <option value="out">我们→客户</option>
              <option value="in">客户→我们</option>
              <option value="internal">内部</option>
            </select>
          </label>
          <label className="text-[11px] text-muted-foreground">时间
            <input type="datetime-local" name="occurred_at" className={`${inputCls} w-full`} />
          </label>
          <label className="text-[11px] text-muted-foreground">关联机会（可选）
            <select name="deal_id" className={`${inputCls} w-full`}>
              <option value="">—</option>
              {deals.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
            </select>
          </label>
          <label className="text-[11px] text-muted-foreground col-span-2">摘要 *
            <input name="title" required className={`${inputCls} w-full`} placeholder="如：电话沟通，客户要 800 件报价" />
          </label>
          <label className="text-[11px] text-muted-foreground col-span-2">详情
            <textarea name="body" rows={2} className={`${inputCls} w-full`} />
          </label>
          {contacts.length > 0 && (
            <label className="text-[11px] text-muted-foreground">联系人（可选）
              <select name="contact_id" className={`${inputCls} w-full`}>
                <option value="">—</option>
                {contacts.map((c) => <option key={c.id} value={c.id}>{c.full_name ?? c.id}</option>)}
              </select>
            </label>
          )}
          <div className="col-span-2"><button className="text-xs px-3 py-1.5 bg-primary text-primary-foreground rounded-md">记录</button></div>
        </form>
      </details>

      {/* 时间线 */}
      {events.length === 0 ? (
        <p className="text-sm text-muted-foreground">暂无互动记录。</p>
      ) : (
        <ol className="space-y-2">
          {events.map((e) => (
            <li key={e.id} className="flex gap-2 text-sm">
              <span className="text-[11px] text-muted-foreground w-20 shrink-0 pt-0.5">{new Date(e.occurred_at).toLocaleDateString()}</span>
              <span className="shrink-0">{ICON[e.event_type] ?? '•'}</span>
              <div className="min-w-0">
                <p className="text-sm">
                  <span className="text-[10px] text-muted-foreground mr-1">{e.direction === 'in' ? '客户→' : e.direction === 'out' ? '我们→' : ''}</span>
                  {e.title}
                  {e.source === 'manual' && <span className="text-[10px] text-muted-foreground ml-1">(人工录)</span>}
                </p>
                {e.body && <p className="text-xs text-muted-foreground line-clamp-2 whitespace-pre-wrap">{e.body}</p>}
              </div>
              {e.owner && <span className="ml-auto text-[10px] text-muted-foreground shrink-0">{e.owner}</span>}
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
