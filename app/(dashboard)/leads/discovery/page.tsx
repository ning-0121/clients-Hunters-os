import { triggerDiscovery } from '@/actions/discovery'
import { createClient } from '@/lib/supabase/server'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

const DISCOVERY_PRESETS = [
  {
    id: 'quick_us',
    label: 'Quick — US Activewear Brands',
    description: 'Find 10-15 US-based DTC activewear brands in minutes',
    icon: '⚡',
    params: { searchMode: 'quick', targetMarket: 'US', maxLeads: 15 },
  },
  {
    id: 'latam',
    label: 'LATAM Markets (Brazil + Mexico)',
    description: 'Target activewear brands in Brazil and Mexico',
    icon: '🌎',
    params: { searchMode: 'targeted', targetMarket: 'LATAM', targetType: 'latam', maxLeads: 20 },
  },
  {
    id: 'amazon_sellers',
    label: 'Amazon FBA Activewear Sellers',
    description: 'Find Amazon private label activewear sellers',
    icon: '📦',
    params: { searchMode: 'targeted', targetType: 'amazon_seller', maxLeads: 20 },
  },
  {
    id: 'tiktok_sellers',
    label: 'TikTok Shop Sellers',
    description: 'Discover activewear brands selling on TikTok Shop',
    icon: '🎵',
    params: { searchMode: 'targeted', targetType: 'tiktok_seller', maxLeads: 20 },
  },
  {
    id: 'deep_dtc',
    label: 'Deep — DTC Brands (Global)',
    description: 'Comprehensive search for DTC activewear brands globally',
    icon: '🔍',
    params: { searchMode: 'deep', targetType: 'dtc_brand', maxLeads: 30 },
  },
]

export default async function DiscoveryPage() {
  const supabase = await createClient()

  const { data: recentJobs } = await supabase
    .from('agent_actions')
    .select('id, action_type, status, output_data, created_at, duration_ms')
    .eq('agent_type', 'discovery_agent')
    .order('created_at', { ascending: false })
    .limit(5)

  const { count: queuedJobs } = await supabase
    .from('agent_queue')
    .select('*', { count: 'exact', head: true })
    .in('status', ['waiting', 'active'])

  return (
    <div className="p-6 max-w-4xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Lead Discovery</h1>
        <p className="text-muted-foreground text-sm mt-1">
          AI automatically finds, evaluates, and scores new prospects
        </p>
        {(queuedJobs ?? 0) > 0 && (
          <div className="mt-2 inline-flex items-center gap-2 text-sm text-blue-600 bg-blue-50 px-3 py-1.5 rounded-full">
            <span className="animate-pulse h-2 w-2 rounded-full bg-blue-500 inline-block" />
            {queuedJobs} jobs in queue
          </div>
        )}
      </div>

      {/* Discovery Presets */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
        {DISCOVERY_PRESETS.map((preset) => (
          <Card key={preset.id} className="hover:shadow-md transition-shadow">
            <CardContent className="pt-5 pb-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xl">{preset.icon}</span>
                    <span className="font-medium text-sm">{preset.label}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">{preset.description}</p>
                </div>
                <form action={triggerDiscovery}>
                  <input type="hidden" name="params" value={JSON.stringify(preset.params)} />
                  <Button type="submit" size="sm" variant="outline" className="shrink-0">
                    Run
                  </Button>
                </form>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Custom Query */}
      <Card className="mb-8">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Custom Search Query</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={triggerDiscovery} className="flex gap-3">
            <input type="hidden" name="mode" value="custom" />
            <input
              type="text"
              name="customQuery"
              placeholder='e.g. "yoga leggings brand" site:instagram.com'
              className="flex-1 px-3 py-2 text-sm border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <Button type="submit" size="sm">Search</Button>
          </form>
        </CardContent>
      </Card>

      {/* Recent Jobs */}
      {recentJobs && recentJobs.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Recent Discovery Runs</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {recentJobs.map((job) => {
              const output = job.output_data as Record<string, number> | null
              return (
                <div key={job.id} className="flex items-center justify-between py-2 border-b last:border-0">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className={`h-2 w-2 rounded-full ${
                        job.status === 'completed' ? 'bg-green-500' :
                        job.status === 'running' ? 'bg-blue-500 animate-pulse' :
                        job.status === 'failed' ? 'bg-red-500' : 'bg-gray-400'
                      }`} />
                      <span className="text-sm font-medium capitalize">{job.status}</span>
                    </div>
                    {output && (
                      <p className="text-xs text-muted-foreground mt-0.5 ml-4">
                        {output.saved ?? 0} saved · {output.qualified ?? 0} qualified · {output.rawResults ?? 0} found
                      </p>
                    )}
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-muted-foreground">
                      {new Date(job.created_at).toLocaleTimeString()}
                    </p>
                    {job.duration_ms && (
                      <p className="text-xs text-muted-foreground">{(job.duration_ms / 1000).toFixed(1)}s</p>
                    )}
                  </div>
                </div>
              )
            })}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
