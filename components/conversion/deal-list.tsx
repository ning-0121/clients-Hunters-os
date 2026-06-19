import Link from 'next/link'
import { STAGE_LABELS, type DealStage } from '@/lib/deals/stage'

export interface DealRow {
  id: string
  title: string
  stage: DealStage
  status: string
  owner: string | null
  next_action: string | null
  next_action_due_at: string | null
  stage_entered_at: string | null
  est_value_usd: number | null
  win_prob: number | null
}

const STAGE_STYLE: Record<string, string> = {
  lead: 'bg-gray-100 text-gray-700', contacted: 'bg-slate-100 text-slate-700',
  replied: 'bg-blue-100 text-blue-700', sample: 'bg-cyan-100 text-cyan-700',
  quotation: 'bg-indigo-100 text-indigo-700', negotiation: 'bg-violet-100 text-violet-700',
  trial_order: 'bg-amber-100 text-amber-800', won: 'bg-green-100 text-green-700',
  lost: 'bg-red-100 text-red-700',
}

function daysIn(ts?: string | null): number | null {
  if (!ts) return null
  return Math.floor((Date.now() - new Date(ts).getTime()) / 86_400_000)
}

export function DealList({ deals }: { deals: DealRow[] }) {
  if (!deals.length) return <p className="text-sm text-muted-foreground">暂无机会。点「＋新建机会」创建。</p>
  return (
    <div className="space-y-2">
      {deals.map((d) => {
        const days = daysIn(d.stage_entered_at)
        const overdue = !!d.next_action_due_at && new Date(d.next_action_due_at).getTime() < Date.now()
        return (
          <Link key={d.id} href={`/deals/${d.id}`} className="block border rounded-md px-3 py-2 hover:bg-accent/40 transition-colors">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${STAGE_STYLE[d.stage] ?? 'bg-gray-100'}`}>{STAGE_LABELS[d.stage]}</span>
              <span className="font-medium text-sm truncate">{d.title}</span>
              {days != null && d.status === 'open' && <span className="text-[11px] text-muted-foreground">停留 {days} 天</span>}
              {d.est_value_usd != null && <span className="text-[11px] text-muted-foreground">${Number(d.est_value_usd).toLocaleString()}</span>}
              {d.win_prob != null && <span className="text-[11px] text-muted-foreground">{d.win_prob}%</span>}
              <span className="ml-auto text-[11px] text-muted-foreground">{d.owner ?? '未分配'}</span>
            </div>
            {d.next_action && (
              <p className={`text-xs mt-1 ${overdue ? 'text-red-600' : 'text-muted-foreground'}`}>
                下一步：{d.next_action}{d.next_action_due_at ? ` · ${new Date(d.next_action_due_at).toLocaleDateString()}` : ''}{overdue ? ' ⚠ 逾期' : ''}
              </p>
            )}
          </Link>
        )
      })}
    </div>
  )
}
