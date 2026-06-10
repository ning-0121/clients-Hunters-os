import { createServiceClient as createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { completeTask, dismissTask, draftReply } from '@/actions/tasks'

const TYPE_LABEL: Record<string, string> = {
  reply_needed:         'Reply',
  sample_followup:      'Sample',
  quote_followup:       'Quote',
  meeting_prep:         'Meeting',
  approval_needed:      'Approval',
  dormant_reactivation: 'Reactivate',
  manual:               'Manual',
}

const PRIORITY_DOT: Record<number, string> = {
  1: 'bg-red-500', 2: 'bg-orange-500', 3: 'bg-yellow-500',
}

export default async function TasksPage() {
  const supabase = await createClient()

  const { data: tasks } = await supabase
    .from('tasks')
    .select('*, companies(name, grade, status), contacts(full_name, email)')
    .in('status', ['open', 'in_progress'])
    .order('priority', { ascending: true })
    .order('due_at', { ascending: true })
    .limit(100)

  const now = Date.now()
  const overdue  = (tasks ?? []).filter(t => t.due_at && new Date(t.due_at).getTime() < now - 86_400_000)
  const today    = (tasks ?? []).filter(t => !overdue.includes(t))

  const counts = {
    total:   tasks?.length ?? 0,
    reply:   tasks?.filter(t => t.task_type === 'reply_needed' || t.task_type === 'meeting_prep').length ?? 0,
    sample:  tasks?.filter(t => t.task_type === 'sample_followup').length ?? 0,
    overdue: overdue.length,
  }

  return (
    <div className="p-6 max-w-4xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Today&apos;s Tasks</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {counts.total} open · {counts.reply} replies to handle · {counts.sample} samples · {counts.overdue} overdue
        </p>
      </div>

      {(!tasks || tasks.length === 0) && (
        <Card><CardContent className="py-12 text-center text-muted-foreground text-sm">
          🎉 No open tasks. Inbox zero.
        </CardContent></Card>
      )}

      {overdue.length > 0 && (
        <>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-red-600 mb-2">Overdue</h2>
          <div className="space-y-2 mb-6">
            {overdue.map(t => <TaskRow key={t.id} task={t} />)}
          </div>
        </>
      )}

      {today.length > 0 && (
        <>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Active</h2>
          <div className="space-y-2">
            {today.map(t => <TaskRow key={t.id} task={t} />)}
          </div>
        </>
      )}
    </div>
  )
}

function TaskRow({ task }: { task: Record<string, any> }) {
  const company = Array.isArray(task.companies) ? task.companies[0] : task.companies
  const contact = Array.isArray(task.contacts) ? task.contacts[0] : task.contacts

  return (
    <Card>
      <CardContent className="py-3">
        <div className="flex items-start gap-3">
          <span className={`mt-1.5 h-2 w-2 rounded-full shrink-0 ${PRIORITY_DOT[task.priority] ?? 'bg-gray-300'}`} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium text-sm">{task.title}</span>
              <Badge variant="outline" className="text-[10px]">{TYPE_LABEL[task.task_type] ?? task.task_type}</Badge>
              {company?.grade && (
                <span className="text-[10px] font-bold text-muted-foreground">Grade {company.grade}</span>
              )}
              {task.status === 'in_progress' && (
                <Badge variant="secondary" className="text-[10px]">In progress</Badge>
              )}
            </div>
            {company && (
              <Link href={`/companies/${task.company_id}`} className="text-xs text-blue-600 hover:underline">
                {company.name}{contact?.full_name ? ` · ${contact.full_name}` : ''}
              </Link>
            )}
            {task.detail && (
              <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{task.detail}</p>
            )}
            {task.suggested_action && (
              <p className="text-xs mt-1.5 bg-muted/50 rounded px-2 py-1.5 text-foreground/80">
                💡 {task.suggested_action}
              </p>
            )}
          </div>

          {/* Actions */}
          <div className="flex flex-col gap-1.5 shrink-0">
            {task.reply_event_id && (
              <form action={draftReply}>
                <input type="hidden" name="replyEventId" value={task.reply_event_id} />
                <input type="hidden" name="taskId" value={task.id} />
                <button type="submit" className="text-xs px-3 py-1 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors w-full whitespace-nowrap">
                  AI Draft Reply
                </button>
              </form>
            )}
            <form action={completeTask}>
              <input type="hidden" name="taskId" value={task.id} />
              <button type="submit" className="text-xs px-3 py-1 border rounded-md hover:bg-accent transition-colors w-full">
                Done
              </button>
            </form>
            <form action={dismissTask}>
              <input type="hidden" name="taskId" value={task.id} />
              <button type="submit" className="text-xs px-3 py-1 text-muted-foreground hover:text-foreground transition-colors w-full">
                Dismiss
              </button>
            </form>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
