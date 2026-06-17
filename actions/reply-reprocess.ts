'use server'

import { createServiceClient } from '@/lib/supabase/server'
import { cleanReplyBody, classifyReplyIntent, classifySentiment, NON_ACTIONABLE_INTENTS } from '@/lib/email/reply-intel'
import { revalidatePath } from 'next/cache'

/**
 * Re-classify historical reply_events with the upgraded logic: clean MIME bodies,
 * re-detect bounce / auto-reply / unsubscribe, and close the "客户回复待处理"
 * tasks that were created for non-actionable replies (e.g. delivery failures).
 */
export async function reprocessReplies(): Promise<void> {
  try {
    const sb = await createServiceClient()
    const { data: events } = await sb.from('reply_events')
      .select('id, from_email, reply_subject, reply_body, contact_id')
      .order('received_at', { ascending: false }).limit(1000)

    for (const e of events ?? []) {
      const body = cleanReplyBody(String(e.reply_body ?? ''))
      const intent = classifyReplyIntent(String(e.from_email ?? ''), String(e.reply_subject ?? ''), body)
      const sentiment = intent === 'bounce' ? 'bounce' : classifySentiment(body)

      await sb.from('reply_events').update({ reply_body: body, reply_intent: intent, reply_sentiment: sentiment }).eq('id', e.id)

      if (NON_ACTIONABLE_INTENTS.has(intent)) {
        // Close any open task created for this non-actionable reply.
        await sb.from('tasks')
          .update({ status: 'done', completed_at: new Date().toISOString(), completed_by: 'reprocess', updated_at: new Date().toISOString() })
          .eq('reply_event_id', e.id).neq('status', 'done')
        // For a confirmed bounce, flag the contact's email as undeliverable.
        if (intent === 'bounce' && e.contact_id) {
          await sb.from('contacts').update({ email_deliverable: false, email_verified: false }).eq('id', e.contact_id)
        }
      }
    }
  } catch (err) {
    console.error('[reprocessReplies]', err)
  }
  revalidatePath('/bd/replies')
  revalidatePath('/tasks')
  revalidatePath('/bd/today')
}
