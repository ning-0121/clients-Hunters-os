import { createServiceClient as createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { updateSampleStatus } from '@/actions/samples'

const STATUS_FLOW = ['requested','confirmed','in_production','shipped','delivered','feedback_received','approved','rejected']

const STATUS_STYLE: Record<string, string> = {
  requested:         'bg-gray-100 text-gray-700',
  confirmed:         'bg-blue-100 text-blue-700',
  in_production:     'bg-indigo-100 text-indigo-700',
  shipped:           'bg-purple-100 text-purple-700',
  delivered:         'bg-cyan-100 text-cyan-700',
  feedback_received: 'bg-yellow-100 text-yellow-700',
  approved:          'bg-green-100 text-green-700',
  rejected:          'bg-red-100 text-red-700',
}

// What status can this sample move to next?
function nextStatuses(current: string): string[] {
  const idx = STATUS_FLOW.indexOf(current)
  if (current === 'delivered' || current === 'feedback_received') return ['approved', 'rejected']
  if (idx >= 0 && idx < 4) return [STATUS_FLOW[idx + 1]]
  return []
}

export default async function SamplesPage() {
  const supabase = await createClient()

  const { data: samples } = await supabase
    .from('samples')
    .select('*, companies(name, grade)')
    .order('created_at', { ascending: false })
    .limit(100)

  const active = (samples ?? []).filter(s => !['approved','rejected'].includes(s.status))
  const closed = (samples ?? []).filter(s => ['approved','rejected'].includes(s.status))

  const won = closed.filter(s => s.status === 'approved').length
  const conversionRate = closed.length ? Math.round(won / closed.length * 100) : 0

  return (
    <div className="p-6 max-w-5xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Samples</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {active.length} active · {won} approved · {conversionRate}% sample→approval rate
        </p>
      </div>

      {(!samples || samples.length === 0) && (
        <Card><CardContent className="py-12 text-center text-muted-foreground text-sm">
          No samples yet. Create one from a company page when a prospect requests a sample.
        </CardContent></Card>
      )}

      {active.length > 0 && (
        <Card className="mb-6">
          <CardHeader className="pb-2"><CardTitle className="text-sm">Active Samples</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {active.map(s => <SampleRow key={s.id} sample={s} />)}
          </CardContent>
        </Card>
      )}

      {closed.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Closed</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {closed.map(s => <SampleRow key={s.id} sample={s} />)}
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function SampleRow({ sample }: { sample: Record<string, any> }) {
  const company = Array.isArray(sample.companies) ? sample.companies[0] : sample.companies
  const next = nextStatuses(sample.status)

  return (
    <div className="border-b last:border-0 pb-3 last:pb-0">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${STATUS_STYLE[sample.status]}`}>
              {sample.status.replace(/_/g, ' ')}
            </span>
            {company && (
              <Link href={`/companies/${sample.company_id}`} className="text-sm font-medium text-blue-600 hover:underline">
                {company.name}
              </Link>
            )}
            {company?.grade && <span className="text-[10px] text-muted-foreground font-bold">Grade {company.grade}</span>}
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            {sample.styles_requested?.length ? sample.styles_requested.join(', ') : 'Styles TBD'}
            {sample.quantity ? ` · ${sample.quantity} pcs` : ''}
            {sample.shipping_country ? ` · → ${sample.shipping_country}` : ''}
          </div>
          {sample.tracking_number && (
            <div className="text-xs text-muted-foreground mt-0.5">
              {sample.carrier ?? 'Tracking'}: {sample.tracking_number}
            </div>
          )}
          {sample.feedback && (
            <p className="text-xs mt-1 bg-muted/50 rounded px-2 py-1">{sample.feedback}</p>
          )}
        </div>

        {/* Status advance buttons */}
        {next.length > 0 && (
          <div className="flex flex-col gap-1.5 shrink-0">
            {next.map(ns => (
              <form key={ns} action={updateSampleStatus}>
                <input type="hidden" name="sampleId" value={sample.id} />
                <input type="hidden" name="status" value={ns} />
                <button
                  type="submit"
                  className={`text-xs px-3 py-1 rounded-md w-full whitespace-nowrap transition-colors ${
                    ns === 'rejected'
                      ? 'border text-muted-foreground hover:text-red-600'
                      : 'bg-primary text-primary-foreground hover:bg-primary/90'
                  }`}
                >
                  Mark {ns.replace(/_/g, ' ')}
                </button>
              </form>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
