import { checkDeliverability } from '@/lib/email/deliverability'
import { getSendStats } from '@/lib/email/throttle'

const SENDER_DOMAIN = (process.env.SENDER_EMAIL ?? 'alex@jojofashion.us').split('@')[1]

function StatusBadge({ status }: { status: 'pass' | 'fail' | 'warn' }) {
  const styles = {
    pass: 'bg-green-100 text-green-800 border-green-200',
    warn: 'bg-yellow-100 text-yellow-800 border-yellow-200',
    fail: 'bg-red-100 text-red-800 border-red-200',
  }
  const labels = { pass: '✅ Pass', warn: '⚠️ Warn', fail: '❌ Fail' }
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
  const [report, stats] = await Promise.all([
    checkDeliverability(SENDER_DOMAIN),
    getSendStats(),
  ])

  const checks = [
    { label: 'SPF Record', record: report.spf },
    { label: 'DKIM Signing', record: report.dkim },
    { label: 'DMARC Policy', record: report.dmarc },
  ]

  return (
    <div className="p-6 max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Email Health</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Deliverability check for <strong>{SENDER_DOMAIN}</strong>
          <span className="ml-2 text-xs opacity-60">checked {new Date(report.checkedAt).toLocaleTimeString()}</span>
        </p>
      </div>

      {/* Overall Score */}
      <div className="rounded-lg border p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Overall Deliverability Score</h2>
          <span className={`text-sm font-bold px-3 py-1 rounded-full ${
            report.overallStatus === 'good' ? 'bg-green-100 text-green-800' :
            report.overallStatus === 'warn' ? 'bg-yellow-100 text-yellow-800' :
            'bg-red-100 text-red-800'
          }`}>
            {report.overallStatus === 'good' ? '🟢 Good' : report.overallStatus === 'warn' ? '🟡 At Risk' : '🔴 Danger'}
          </span>
        </div>
        <ScoreMeter score={report.overallScore} />
        {report.overallStatus !== 'good' && (
          <p className="text-sm text-red-600">
            ⚠️ Fix the items below before sending at scale — emails may go to spam.
          </p>
        )}
      </div>

      {/* DNS Checks */}
      <div className="rounded-lg border divide-y">
        <div className="px-5 py-3 bg-muted/40">
          <h2 className="font-semibold text-sm">DNS Authentication Records</h2>
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
                <strong>Action needed:</strong> {record.recommendation}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Send Rate Stats */}
      <div className="rounded-lg border divide-y">
        <div className="px-5 py-3 bg-muted/40">
          <h2 className="font-semibold text-sm">Sending Rate</h2>
        </div>
        <div className="px-5 py-4">
          <div className="grid grid-cols-3 gap-4 mb-4">
            <div className="text-center">
              <div className="text-2xl font-bold">{stats.sentToday}</div>
              <div className="text-xs text-muted-foreground">Sent Today</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold">{stats.sent7d}</div>
              <div className="text-xs text-muted-foreground">Last 7 days</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold">{stats.sent30d}</div>
              <div className="text-xs text-muted-foreground">Last 30 days</div>
            </div>
          </div>
          <div className="space-y-1.5">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Today&apos;s limit</span>
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
              Ramp day {stats.rampDay} — limit increases automatically as domain reputation builds
            </p>
          </div>
        </div>
      </div>

      {/* Ramp Schedule */}
      <div className="rounded-lg border divide-y">
        <div className="px-5 py-3 bg-muted/40">
          <h2 className="font-semibold text-sm">Warmup Ramp Schedule</h2>
        </div>
        <div className="px-5 py-4">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-muted-foreground">
                <th className="text-left pb-2">Period</th>
                <th className="text-left pb-2">Daily Limit</th>
                <th className="text-left pb-2">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {[
                { period: 'Days 1–7',  limit: 20  },
                { period: 'Days 8–14', limit: 40  },
                { period: 'Days 15–21', limit: 80 },
                { period: 'Days 22+',  limit: 150 },
              ].map((row, i) => {
                const thresholds = [7, 14, 21, 999]
                const isActive = stats.rampDay <= thresholds[i] && (i === 0 || stats.rampDay > thresholds[i - 1])
                const isDone   = stats.rampDay > thresholds[i]
                return (
                  <tr key={row.period} className={isActive ? 'font-semibold' : ''}>
                    <td className="py-2 text-muted-foreground">{row.period}</td>
                    <td className="py-2">{row.limit} emails/day</td>
                    <td className="py-2">
                      {isDone ? <span className="text-green-600 text-xs">✓ Complete</span>
                       : isActive ? <span className="text-blue-600 text-xs">◉ Active</span>
                       : <span className="text-muted-foreground text-xs">Upcoming</span>}
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
          <h2 className="font-semibold text-orange-900">🔑 Action Required: Enable DKIM</h2>
          <p className="text-sm text-orange-800">
            Without DKIM, your emails have no cryptographic signature and are likely to be flagged as spam.
          </p>
          <ol className="text-sm text-orange-800 space-y-1 list-decimal list-inside">
            <li>Go to <strong>admin.google.com</strong></li>
            <li>Apps → Google Workspace → Gmail → <strong>Authenticate email</strong></li>
            <li>Select domain: <strong>{SENDER_DOMAIN}</strong></li>
            <li>Click <strong>Generate new record</strong></li>
            <li>Copy the TXT record value</li>
            <li>Add it to your DNS as: <code className="bg-orange-100 px-1 rounded">google._domainkey.{SENDER_DOMAIN}</code></li>
            <li>Return to Google Admin and click <strong>Start authentication</strong></li>
            <li>Refresh this page to verify</li>
          </ol>
        </div>
      )}
    </div>
  )
}
