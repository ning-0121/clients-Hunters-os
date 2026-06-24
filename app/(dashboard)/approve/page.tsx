import Link from 'next/link'
import { createServiceClient } from '@/lib/supabase/server'
import { computeCredibility, isReachableTier } from '@/lib/contacts/credibility'
import { checkSendThrottle } from '@/lib/email/throttle'
import { isGmailConfigured } from '@/lib/email/gmail'
import { approveAndSend, skipDraft } from '@/actions/sales'

export const dynamic = 'force-dynamic'

/**
 * Execution OS — Approve Stream. Every pre-generated outreach draft is an Execute
 * Card: read the system's writing, then 批准并发送 (one tap) / 改 / 跳过.
 * The human approves; the system already did the work.
 */
export default async function ApproveStreamPage() {
  const sb = await createServiceClient()
  const [{ data: drafts }, throttle] = await Promise.all([
    sb.from('outreach_logs')
      .select('id, company_id, subject, body, contacts(full_name, email, email_verified, email_source, email_confidence), companies(name, source_raw)')
      .eq('status', 'pending_approval').not('contact_id', 'is', null)
      .order('created_at', { ascending: false }).limit(30),
    checkSendThrottle().catch(() => null),
  ])

  const cards = (drafts ?? []).map((d) => {
    const c = Array.isArray(d.contacts) ? d.contacts[0] : d.contacts
    const co = Array.isArray(d.companies) ? d.companies[0] : d.companies
    const verified = c ? isReachableTier(computeCredibility(c).tier) : false
    return {
      id: d.id as string, companyId: d.company_id as string,
      brand: ((co?.source_raw as Record<string, unknown> | null)?.brand as string) || (co?.name as string) || '?',
      contact: (c?.full_name as string) || '(联系人)', email: (c?.email as string) || '',
      verified, subject: (d.subject as string) || '(无主题)', body: (d.body as string) || '',
    }
  })

  const emailConfigured = isGmailConfigured()

  return (
    <div className="p-6 max-w-3xl">
      <h1 className="text-2xl font-bold mb-1">批准并发送 · Approve Stream</h1>
      {!emailConfigured && (
        <div className="rounded-md border-2 border-red-300 bg-red-50 px-4 py-2.5 mb-3 text-sm text-red-800">
          🔴 邮件未配置（本环境 GMAIL/SMTP 为空）—— 发送已禁用，不会假发送。
          <span className="block text-xs mt-0.5">启用：在 Vercel 生产环境填入 GMAIL_USER · GMAIL_APP_PASSWORD · SMTP_HOST · SMTP_PORT=465 · SENDER_EMAIL · SENDER_NAME（值见本地 .env.local），重新部署即可。</span>
        </div>
      )}
      <p className="text-xs text-muted-foreground mb-1">系统已写好。你只读一眼 → 批准。绿色=邮箱已验证可直接发；其余系统会拦（不发猜测邮箱）。</p>
      <p className="text-xs text-muted-foreground mb-4">
        今日已发 {throttle?.sentToday ?? 0}/{throttle?.dailyLimit ?? '—'}（预热 Day {throttle?.rampDay ?? '—'}）
        {throttle && !throttle.allowed && <span className="text-amber-700"> · ⏳ {throttle.reason}</span>}
        {' · '}待批准 {cards.length}
      </p>

      {cards.length === 0 && <p className="text-sm text-muted-foreground">没有待批准的草稿。去 <Link href="/today" className="text-primary hover:underline">今日行动</Link> 或客户页生成。</p>}

      <div className="space-y-4">
        {cards.map((card) => (
          <div key={card.id} className={`rounded-lg border ${card.verified ? 'border-green-300' : 'border-amber-300'}`}>
            <div className="px-4 py-2 flex items-center justify-between text-xs border-b bg-muted/30">
              <span className="font-semibold">{card.brand} → {card.contact}</span>
              <span className={card.verified ? 'text-green-700' : 'text-amber-700'}>
                {card.verified ? '🟢 邮箱已验证 · 可发' : '🟠 邮箱未验证 · 系统会拦'} {card.email && `· ${card.email}`}
              </span>
            </div>
            <div className="p-4 text-sm space-y-1">
              <div><span className="text-muted-foreground">主题：</span>{card.subject}</div>
              <pre className="whitespace-pre-wrap font-sans text-xs text-muted-foreground border rounded-md p-2 bg-background max-h-44 overflow-y-auto">{card.body}</pre>
              <div className="flex items-center gap-2 pt-1">
                <form action={approveAndSend}>
                  <input type="hidden" name="outreachLogId" value={card.id} />
                  <button className="px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-40" disabled={!card.verified || !emailConfigured}>
                    ✅ 批准并发送
                  </button>
                </form>
                <Link href={`/companies/${card.companyId}/outreach`} className="px-3 py-2 border rounded-md text-sm hover:bg-accent">✏️ 改</Link>
                <form action={skipDraft}>
                  <input type="hidden" name="outreachLogId" value={card.id} />
                  <button className="px-3 py-2 border rounded-md text-sm text-muted-foreground hover:bg-accent">⏭ 跳过</button>
                </form>
                {!card.verified && <span className="text-[11px] text-amber-700">先验证邮箱（客户页「验证邮箱」）才能发</span>}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
