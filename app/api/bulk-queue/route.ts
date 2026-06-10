import { NextRequest, NextResponse } from 'next/server'
import { createDirectClient } from '@/lib/supabase/server'

export async function POST(req: NextRequest) {
  // Auth check — same pattern as /api/agents/trigger
  const authHeader = req.headers.get('authorization')
  const appSecret  = process.env.APP_SECRET
  if (!appSecret || authHeader !== `Bearer ${appSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const supabase = createDirectClient()

  // Get all raw companies
  const { data: rawCompanies } = await supabase
    .from('companies')
    .select('id')
    .eq('status', 'raw')

  if (!rawCompanies?.length) {
    return NextResponse.json({ queued: 0, message: 'No raw companies found' })
  }

  // Queue enrich for each (skip if already queued)
  const jobs = rawCompanies.map((c) => ({
    job_type: 'enrich_company',
    payload: { companyId: c.id },
    priority: 4,
  }))

  const { error } = await supabase.from('agent_queue').insert(jobs)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ queued: jobs.length })
}
