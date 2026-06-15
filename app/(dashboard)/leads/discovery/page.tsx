import { triggerDiscovery } from '@/actions/discovery'
import { createServiceClient as createClient } from '@/lib/supabase/server'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

const DISCOVERY_PRESETS = [
  {
    id: 'quick_us',
    label: '快速 — 美国运动服品牌',
    description: '几分钟内找到 10-15 家美国 DTC 运动服品牌',
    icon: '⚡',
    params: { searchMode: 'quick', targetMarket: 'US', maxLeads: 15 },
  },
  {
    id: 'latam',
    label: '拉美市场（巴西 + 墨西哥）',
    description: '定向开发巴西和墨西哥的运动服品牌',
    icon: '🌎',
    params: { searchMode: 'targeted', targetMarket: 'LATAM', targetType: 'latam', maxLeads: 20 },
  },
  {
    id: 'amazon_sellers',
    label: '亚马逊 FBA 运动服卖家',
    description: '寻找亚马逊自有品牌运动服卖家',
    icon: '📦',
    params: { searchMode: 'targeted', targetType: 'amazon_seller', maxLeads: 20 },
  },
  {
    id: 'tiktok_sellers',
    label: 'TikTok Shop 卖家',
    description: '发现在 TikTok Shop 卖运动服的品牌',
    icon: '🎵',
    params: { searchMode: 'targeted', targetType: 'tiktok_seller', maxLeads: 20 },
  },
  {
    id: 'deep_dtc',
    label: '深度 — 全球 DTC 品牌',
    description: '全球范围深度搜索 DTC 运动服品牌',
    icon: '🔍',
    params: { searchMode: 'deep', targetType: 'dtc_brand', maxLeads: 30 },
  },
  {
    id: 'domestic_trade',
    label: '国内服装外贸公司',
    description: '义乌/杭州/宁波/广州/深圳/上海 服装·运动服外贸公司 — 订单合作 + 软件客户',
    icon: '🇨🇳',
    params: { searchMode: 'targeted', targetType: 'domestic_trade', maxLeads: 20 },
  },
  {
    id: 'recruitment',
    label: '招聘信号线索（正在扩张）',
    description: '搜 BOSS/猎聘 上招「外贸跟单/业务员」的服装公司 — 正在扩张 = 开发时机最佳',
    icon: '📈',
    params: { searchMode: 'targeted', targetType: 'recruitment', maxLeads: 20 },
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
        <h1 className="text-2xl font-bold">线索发现</h1>
        <p className="text-muted-foreground text-sm mt-1">
          AI 自动寻找、评估并给新客户线索打分
        </p>
        {(queuedJobs ?? 0) > 0 && (
          <div className="mt-2 inline-flex items-center gap-2 text-sm text-blue-600 bg-blue-50 px-3 py-1.5 rounded-full">
            <span className="animate-pulse h-2 w-2 rounded-full bg-blue-500 inline-block" />
            {queuedJobs} 个任务排队中
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
                    运行
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
          <CardTitle className="text-sm">自定义搜索词</CardTitle>
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
            <Button type="submit" size="sm">搜索</Button>
          </form>
        </CardContent>
      </Card>

      {/* Recent Jobs */}
      {recentJobs && recentJobs.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">最近的发现任务</CardTitle>
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
                      <span className="text-sm font-medium">{({completed:'完成',running:'运行中',failed:'失败'} as Record<string,string>)[job.status] ?? job.status}</span>
                    </div>
                    {output && (
                      <p className="text-xs text-muted-foreground mt-0.5 ml-4">
                        保存 {output.saved ?? 0} · 通过筛选 {output.qualified ?? 0} · 找到 {output.rawResults ?? 0}
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
