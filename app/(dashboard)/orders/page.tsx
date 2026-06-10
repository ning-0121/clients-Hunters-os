import { createServiceClient as createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { confirmOrder } from '@/actions/orders'

const STATUS_STYLE: Record<string, string> = {
  draft:         'bg-gray-100 text-gray-700',
  confirmed:     'bg-blue-100 text-blue-700',
  in_production: 'bg-indigo-100 text-indigo-700',
  shipped:       'bg-purple-100 text-purple-700',
  delivered:     'bg-green-100 text-green-700',
  cancelled:     'bg-red-100 text-red-700',
}

export default async function OrdersPage() {
  const supabase = await createClient()

  const { data: orders } = await supabase
    .from('orders')
    .select('*, companies(name, grade)')
    .order('created_at', { ascending: false })
    .limit(100)

  const totalValue = (orders ?? [])
    .filter(o => o.status !== 'cancelled' && o.status !== 'draft')
    .reduce((sum, o) => sum + (Number(o.order_value_usd) || 0), 0)
  const confirmed = (orders ?? []).filter(o => o.status !== 'draft' && o.status !== 'cancelled').length

  return (
    <div className="p-6 max-w-5xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Orders</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {confirmed} confirmed · ${totalValue.toLocaleString()} pipeline value
        </p>
      </div>

      {(!orders || orders.length === 0) && (
        <Card><CardContent className="py-12 text-center text-muted-foreground text-sm">
          No orders yet. Create one from a company page after sample approval.
        </CardContent></Card>
      )}

      {orders && orders.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">All Orders</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {orders.map((o) => {
              const company = Array.isArray(o.companies) ? o.companies[0] : o.companies
              return (
                <div key={o.id} className="flex items-start justify-between gap-3 border-b last:border-0 pb-3 last:pb-0">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${STATUS_STYLE[o.status]}`}>
                        {o.status.replace(/_/g, ' ')}
                      </span>
                      {company && (
                        <Link href={`/companies/${o.company_id}`} className="text-sm font-medium text-blue-600 hover:underline">
                          {company.name}
                        </Link>
                      )}
                      {o.order_ref && <span className="text-xs text-muted-foreground">{o.order_ref}</span>}
                      {o.pushed_to_metronome && (
                        <span className="text-[10px] text-green-600">→ 节拍器 {o.metronome_ref ?? ''}</span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {o.order_value_usd ? `$${Number(o.order_value_usd).toLocaleString()}` : 'No value'}
                      {o.required_delivery ? ` · deliver by ${o.required_delivery}` : ''}
                      {o.payment_terms ? ` · ${o.payment_terms}` : ''}
                    </div>
                  </div>
                  {o.status === 'draft' && (
                    <form action={confirmOrder}>
                      <input type="hidden" name="orderId" value={o.id} />
                      <button type="submit" className="text-xs px-3 py-1 bg-green-600 text-white rounded-md hover:bg-green-700 transition-colors whitespace-nowrap shrink-0">
                        Confirm → production
                      </button>
                    </form>
                  )}
                </div>
              )
            })}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
