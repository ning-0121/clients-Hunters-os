import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { triggerScoreCompany, triggerEnrichCompany, triggerDraftOutreach } from '@/actions/companies'

const GRADE_STYLES: Record<string, string> = {
  A: 'bg-green-100 text-green-800',
  B: 'bg-blue-100 text-blue-800',
  C: 'bg-yellow-100 text-yellow-800',
  D: 'bg-gray-100 text-gray-500',
}

const SCORE_DIMS = [
  { key: 'icp_fit_score',           label: 'ICP Fit' },
  { key: 'profit_potential_score',  label: 'Profit Potential' },
  { key: 'reply_probability_score', label: 'Reply Probability' },
  { key: 'category_match_score',    label: 'Category Match' },
  { key: 'size_score',              label: 'Company Size' },
  { key: 'ltv_potential_score',     label: 'LTV Potential' },
  { key: 'white_label_fit',         label: 'White Label Fit' },
  { key: 'tiktok_fit',              label: 'TikTok Fit' },
  { key: 'latam_priority',          label: 'LATAM Priority' },
]

export default async function CompanyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const [
    { data: company },
    { data: contacts },
    { data: score },
    { data: outreachLogs },
  ] = await Promise.all([
    supabase.from('companies').select('*').eq('id', id).single(),
    supabase.from('contacts').select('*').eq('company_id', id).order('contact_priority', { ascending: false }),
    supabase.from('customer_scores').select('*').eq('company_id', id).single(),
    supabase.from('outreach_logs').select('*').eq('company_id', id).order('created_at', { ascending: false }).limit(10),
  ])

  if (!company) notFound()

  return (
    <div className="p-6 max-w-5xl">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-2xl font-bold">{company.name}</h1>
            {company.grade && (
              <span className={`text-sm font-bold px-3 py-1 rounded-full ${GRADE_STYLES[company.grade]}`}>
                Grade {company.grade}
              </span>
            )}
            {company.total_score && (
              <span className="text-sm text-muted-foreground font-mono">
                Score: {company.total_score.toFixed(0)}/100
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            {company.website && (
              <a href={company.website} target="_blank" rel="noopener noreferrer" className="hover:underline">
                {company.domain}
              </a>
            )}
            {company.country && <span>{company.country}</span>}
            <Badge variant="outline" className="text-xs capitalize">{company.status}</Badge>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-2 flex-wrap">
          {company.status === 'raw' && (
            <form action={triggerEnrichCompany}>
              <input type="hidden" name="companyId" value={id} />
              <button type="submit" className="text-xs px-3 py-1.5 border rounded-md hover:bg-accent transition-colors">
                Enrich
              </button>
            </form>
          )}
          {company.status === 'enriched' && (
            <form action={triggerScoreCompany}>
              <input type="hidden" name="companyId" value={id} />
              <button type="submit" className="text-xs px-3 py-1.5 border rounded-md hover:bg-accent transition-colors">
                Score
              </button>
            </form>
          )}
          {company.status === 'scored' && !outreachLogs?.length && (
            <form action={triggerDraftOutreach}>
              <input type="hidden" name="companyId" value={id} />
              <button type="submit" className="text-xs px-3 py-1.5 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors">
                Draft Outreach
              </button>
            </form>
          )}
          <Link href={`/companies/${id}/strategy`} className="text-xs px-3 py-1.5 border rounded-md hover:bg-accent transition-colors">
            AI Strategy
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {/* Left column: Company Info */}
        <div className="col-span-2 space-y-4">

          {/* Overview */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Overview</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {company.description && (
                <p className="text-sm text-muted-foreground">{company.description}</p>
              )}
              <div className="grid grid-cols-2 gap-3 text-sm">
                {company.company_type && (
                  <div>
                    <span className="text-muted-foreground">Type: </span>
                    <span className="capitalize">{company.company_type.replace(/_/g, ' ')}</span>
                  </div>
                )}
                {company.price_point && (
                  <div>
                    <span className="text-muted-foreground">Price point: </span>
                    <span className="capitalize">{company.price_point}</span>
                  </div>
                )}
                {company.employee_count_range && (
                  <div>
                    <span className="text-muted-foreground">Employees: </span>
                    <span>{company.employee_count_range}</span>
                  </div>
                )}
                {company.shopify_detected && (
                  <div>
                    <span className="text-xs px-2 py-0.5 bg-green-100 text-green-700 rounded-full">Shopify detected</span>
                  </div>
                )}
              </div>
              {company.product_categories && company.product_categories.length > 0 && (
                <div className="flex gap-1.5 flex-wrap">
                  {company.product_categories.map((cat: string) => (
                    <Badge key={cat} variant="secondary" className="text-xs capitalize">{cat}</Badge>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Score Breakdown */}
          {score && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Score Breakdown</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2 mb-4">
                  {SCORE_DIMS.map(({ key, label }) => {
                    const val = (score as Record<string, unknown>)[key] as number | null
                    if (val === null || val === undefined) return null
                    return (
                      <div key={key} className="flex items-center gap-3">
                        <span className="text-xs text-muted-foreground w-36 shrink-0">{label}</span>
                        <div className="flex-1 bg-muted rounded-full h-1.5">
                          <div
                            className="h-1.5 rounded-full bg-primary transition-all"
                            style={{ width: `${(val / 10) * 100}%` }}
                          />
                        </div>
                        <span className="text-xs font-mono w-8 text-right">{val.toFixed(1)}</span>
                      </div>
                    )
                  })}
                </div>
                {score.score_reasoning && (
                  <p className="text-xs text-muted-foreground border-t pt-3">{score.score_reasoning}</p>
                )}
                {score.recommended_strategy && (
                  <div className="mt-2">
                    <span className="text-xs font-medium">Recommended strategy: </span>
                    <span className="text-xs text-muted-foreground">{score.recommended_strategy}</span>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Outreach History */}
          {outreachLogs && outreachLogs.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Outreach History</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {outreachLogs.map((log) => (
                  <div key={log.id} className="flex items-start justify-between py-2 border-b last:border-0 text-sm">
                    <div>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-xs capitalize">{log.channel}</Badge>
                        <span className="text-xs text-muted-foreground capitalize">{log.status}</span>
                      </div>
                      {log.subject && <p className="text-xs mt-1 text-muted-foreground">{log.subject}</p>}
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-xs text-muted-foreground">
                        {new Date(log.created_at).toLocaleDateString()}
                      </p>
                      {log.reply_sentiment && (
                        <span className={`text-xs ${
                          log.reply_sentiment === 'positive' ? 'text-green-600' :
                          log.reply_sentiment === 'negative' ? 'text-red-600' : 'text-muted-foreground'
                        }`}>
                          {log.reply_sentiment}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>

        {/* Right column: Contacts + Social */}
        <div className="space-y-4">
          {/* Contacts */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Contacts</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {contacts && contacts.length > 0 ? contacts.map((contact) => (
                <div key={contact.id} className="border-b last:border-0 pb-3 last:pb-0">
                  <div className="font-medium text-sm">{contact.full_name ?? 'Unknown'}</div>
                  <div className="text-xs text-muted-foreground">{contact.title}</div>
                  {contact.email && (
                    <a href={`mailto:${contact.email}`} className="text-xs text-blue-600 hover:underline block mt-0.5">
                      {contact.email}
                    </a>
                  )}
                  {contact.linkedin_url && (
                    <a href={contact.linkedin_url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline block">
                      LinkedIn
                    </a>
                  )}
                  {contact.reply_probability && (
                    <div className="text-xs text-muted-foreground mt-1">
                      Reply probability: {(contact.reply_probability * 100).toFixed(0)}%
                    </div>
                  )}
                </div>
              )) : (
                <p className="text-xs text-muted-foreground">No contacts yet. Enrich to find contacts.</p>
              )}
            </CardContent>
          </Card>

          {/* Social */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Social Presence</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {company.instagram_handle && (
                <div>
                  <span className="text-muted-foreground">Instagram: </span>
                  <a href={`https://instagram.com/${company.instagram_handle}`} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                    @{company.instagram_handle}
                  </a>
                  {company.instagram_followers && (
                    <span className="text-xs text-muted-foreground ml-1">
                      ({(company.instagram_followers / 1000).toFixed(1)}k)
                    </span>
                  )}
                </div>
              )}
              {company.tiktok_handle && (
                <div>
                  <span className="text-muted-foreground">TikTok: </span>
                  <a href={`https://tiktok.com/@${company.tiktok_handle}`} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                    @{company.tiktok_handle}
                  </a>
                </div>
              )}
              {company.linkedin_url && (
                <div>
                  <span className="text-muted-foreground">LinkedIn: </span>
                  <a href={company.linkedin_url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                    View page
                  </a>
                </div>
              )}
              {company.amazon_store_url && (
                <div>
                  <span className="text-muted-foreground">Amazon: </span>
                  <a href={company.amazon_store_url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                    Store
                  </a>
                </div>
              )}
              {!company.instagram_handle && !company.tiktok_handle && !company.linkedin_url && (
                <p className="text-xs text-muted-foreground">No social links found yet</p>
              )}
            </CardContent>
          </Card>

          {/* Recommended Strategy */}
          {score?.recommended_channels && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Recommended Channels</CardTitle>
              </CardHeader>
              <CardContent className="flex gap-1.5 flex-wrap">
                {score.recommended_channels.map((channel: string) => (
                  <Badge key={channel} variant="secondary" className="text-xs capitalize">
                    {channel}
                  </Badge>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}
