import { checkDeliverability } from '@/lib/email/deliverability'
import { getSendStats } from '@/lib/email/throttle'
import { checkBounceHealth } from '@/lib/email/bounce-rate'
import { createServiceClient } from '@/lib/supabase/server'

const SENDER_DOMAIN = (process.env.SENDER_EMAIL ?? 'alex@jojofashion.us').split('@')[1]

function StatusBadge({ status }: { status: 'pass' | 'fail' | 'warn' }) {
  const styles = {
    pass: 'bg-green-100 text-green-800 border-green-200',
    warn: 'bg-yellow-100 text-yellow-800 border-yellow-200',
    fail: 'bg-red-100 text-red-800 border-red-200',
  }
  const labels = { pass: '✅ 通过', warn: '⚠️ 警告', fail: '❌ 失败' }
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${styles[status]}`}>
      {labels[status]}
    </span>
  )
}

function ScoreMeter({ score }: { score: number }) {
  const color = score >= 80 ? 'bg-green-500' : score >= 40 ? 'bg-yellow-500' : 'bg-red-500'
  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 bg-muted rounded-full h-2 overflow-hidden">
        <div className={`h-2 rounded-full transition-all ${color}`} style={{ width: `${score}%` }} />
      </div>
      <span className="text-sm font-mono font-bold w-10 text-right">{score}/100</span>
    </div>
  )
}

export default async function EmailHealthPage() {
  const [report, stats, bounce] = await Promise.all([
    checkDeliverability(SENDER_DOMAIN),
    getSendStats(),
    createServiceClient().then(checkBounceHealth),
  ])

  const checks = [
    { label: 'SPF 记录', record: report.spf },
    { label: 'DKIM 签名', record: report.dkim },
    { label: 'DMARC 策略', record: report.dmarc },
  ]

  return (
    <div className="p-6 max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">邮件健康度</h1>
        <p className="text-sm text-muted-foreground mt-1">
          <strong>{SENDER_DOMAIN}</strong> 的送达率检测
          <span className="ml-2 text-xs opacity-60">检测时间 {new Date(report.checkedAt).toLocaleTimeString()}</span>
        </p>
      </div>

      {/* Overall Score */}
      <div className="rounded-lg border p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">综合送达率得分</h2>
          <span className={`text-sm font-bold px-3 py-1 rounded-full ${
            report.overallStatus === 'good' ? 'bg-green-100 text-green-800' :
            report.overallStatus === 'warn' ? 'bg-yellow-100 text-yellow-800' :
            'bg-red-100 text-red-800'
          }`}>
            {report.overallStatus === 'good' ? '🟢 良好' : report.overallStatus === 'warn' ? '🟡 有风险' : '🔴 危险'}
          </span>
        </div>
        <ScoreMeter score={report.overallScore} />
        {report.overallStatus !== 'good' && (
          <p className="text-sm text-red-600">
            ⚠️ 批量发送前请先修复以下问题 — 否则邮件可能进入垃圾箱。
          </p>
        )}
      </div>

      {/* Bounce rate guardrail */}
      <div className="rounded-lg border p-5 space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">退信率（近 14 天）</h2>
          <span className={`text-sm font-bold px-3 py-1 rounded-full ${
            bounce.paused ? 'bg-red-100 text-red-800' : bounce.rate >= 0.04 ? 'bg-yellow-100 text-yellow-800' : 'bg-green-100 text-green-800'
          }`}>
            {(bounce.rate * 100).toFixed(1)}%
          </span>
        </div>
        <p className="text-xs text-muted-foreground">发送 {bounce.sent} · 退信 {bounce.bounced} · 阈值 8%（满 20 封才判定）</p>
        {bounce.paused
          ? <p className="text-sm text-red-600">🛑 已自动暂停发送：{bounce.reason}</p>
          : <p className="text-xs text-muted-foreground">退信率达阈值会自动暂停发送，避免烧毁发信域名声誉。</p>}
      </div>

      {/* DNS Checks */}
      <div className="rounded-lg border divide-y">
        <div className="px-5 py-3 bg-muted/40">
          <h2 className="font-semibold text-sm">DNS 认证记录</h2>
        </div>
        {checks.map(({ label, record }) => (
          <div key={label} className="px-5 py-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-medium text-sm">{label}</span>
              <StatusBadge status={record.status} />
            </div>
            <p className="text-xs text-muted-foreground">{record.message}</p>
            {record.value && record.status === 'pass' && (
              <p className="text-xs font-mono bg-muted px-2 py-1 rounded break-all">
                {record.value}
              </p>
            )}
            {record.recommendation && (
              <div className="text-xs bg-yellow-50 border border-yellow-200 text-yellow-800 px-3 py-2 rounded">
                <strong>需要处理：</strong>{record.recommendation}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Send Rate Stats */}
      <div className="rounded-lg border divide-y">
        <div className="px-5 py-3 bg-muted/40">
          <h2 className="font-semibold text-sm">发送速率</h2>
        </div>
        <div className="px-5 py-4">
          <div className="grid grid-cols-3 gap-4 mb-4">
            <div className="text-center">
              <div className="text-2xl font-bold">{stats.sentToday}</div>
              <div className="text-xs text-muted-foreground">今天已发送</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold">{stats.sent7d}</div>
              <div className="text-xs text-muted-foreground">近 7 天</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold">{stats.sent30d}</div>
              <div className="text-xs text-muted-foreground">近 30 天</div>
            </div>
          </div>
          <div className="space-y-1.5">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">今日额度</span>
              <span className="font-mono font-semibold">{stats.sentToday} / {stats.dailyLimit}</span>
            </div>
            <div className="w-full bg-muted rounded-full h-1.5">
              <div
                className={`h-1.5 rounded-full ${
                  stats.sentToday / stats.dailyLimit > 0.8 ? 'bg-red-500' : 'bg-green-500'
                }`}
                style={{ width: `${Math.min(100, (stats.sentToday / stats.dailyLimit) * 100)}%` }}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              预热第 {stats.rampDay} 天 — 随域名信誉提升，额度将自动提高
            </p>
          </div>
        </div>
      </div>

      {/* Ramp Schedule */}
      <div className="rounded-lg border divide-y">
        <div className="px-5 py-3 bg-muted/40">
          <h2 className="font-semibold text-sm">预热提速计划</h2>
        </div>
        <div className="px-5 py-4">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-muted-foreground">
                <th className="text-left pb-2">阶段</th>
                <th className="text-left pb-2">每日额度</th>
                <th className="text-left pb-2">状态</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {[
                { period: '第 1–7 天',  limit: 20  },
                { period: '第 8–14 天', limit: 40  },
                { period: '第 15–21 天', limit: 80 },
                { period: '第 22 天起',  limit: 150 },
              ].map((row, i) => {
                const thresholds = [7, 14, 21, 999]
                const isActive = stats.rampDay <= thresholds[i] && (i === 0 || stats.rampDay > thresholds[i - 1])
                const isDone   = stats.rampDay > thresholds[i]
                return (
                  <tr key={row.period} className={isActive ? 'font-semibold' : ''}>
                    <td className="py-2 text-muted-foreground">{row.period}</td>
                    <td className="py-2">{row.limit} 封/天</td>
                    <td className="py-2">
                      {isDone ? <span className="text-green-600 text-xs">✓ 已完成</span>
                       : isActive ? <span className="text-blue-600 text-xs">◉ 进行中</span>
                       : <span className="text-muted-foreground text-xs">待开始</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* DKIM Setup Guide */}
      {report.dkim.status === 'fail' && (
        <div className="rounded-lg border border-orange-200 bg-orange-50 p-5 space-y-3">
          <h2 className="font-semibold text-orange-900">🔑 需要处理：启用 DKIM</h2>
          <p className="text-sm text-orange-800">
            未启用 DKIM 时，邮件没有加密签名，很可能被判定为垃圾邮件。
          </p>
          <ol className="text-sm text-orange-800 space-y-1 list-decimal list-inside">
            <li>打开 <strong>admin.google.com</strong></li>
            <li>应用 → Google Workspace → Gmail → <strong>验证电子邮件</strong></li>
            <li>选择域名：<strong>{SENDER_DOMAIN}</strong></li>
            <li>点击<strong>生成新记录</strong></li>
            <li>复制 TXT 记录值</li>
            <li>将其添加到 DNS：<code className="bg-orange-100 px-1 rounded">google._domainkey.{SENDER_DOMAIN}</code></li>
            <li>返回 Google 管理后台并点击<strong>开始身份验证</strong></li>
            <li>刷新本页面进行验证</li>
          </ol>
        </div>
      )}
    </div>
  )
}
