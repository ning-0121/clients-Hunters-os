import { callLLMSimple, type LLMOptions } from '@/lib/llm/client'
import { createServiceClient } from '@/lib/supabase/server'
import { notify } from '@/lib/notify/notifier'
import { withRetry } from '@/lib/util/retry'
import type { AgentType, ActionStatus } from '@/types'

export interface AgentContext {
  companyId?: string
  contactId?: string
  userId?: string
  autonomyLevel?: 'A' | 'B' | 'C'
}

export interface AgentResult {
  success: boolean
  data?: Record<string, unknown>
  needsApproval?: boolean
  approvalType?: string
  approvalPayload?: Record<string, unknown>
  insights?: string[]
  error?: string
}

export abstract class BaseAgent {
  protected agentType: AgentType
  protected defaultModel = 'claude-sonnet-4-6'

  constructor(agentType: AgentType) {
    this.agentType = agentType
  }

  abstract execute(context: AgentContext, input: unknown): Promise<AgentResult>

  protected async callLLM(
    systemPrompt: string,
    userMessage: string,
    options?: Omit<LLMOptions, 'systemPrompt'>
  ): Promise<string> {
    // Retry transient provider errors (Connection error / 429 / 5xx / overloaded)
    // up to 3 times with backoff. Non-transient errors throw immediately.
    return withRetry(() => callLLMSimple(systemPrompt, userMessage, options), {
      label: `llm:${this.agentType}`,
    })
  }

  protected async logAction(params: {
    companyId?: string
    contactId?: string
    actionType: string
    inputData?: Record<string, unknown>
    outputData?: Record<string, unknown>
    status: ActionStatus
    durationMs?: number
    modelUsed?: string
    errorMessage?: string
  }): Promise<string> {
    const supabase = await createServiceClient()
    const { data } = await supabase
      .from('agent_actions')
      .insert({
        company_id: params.companyId,
        contact_id: params.contactId,
        agent_type: this.agentType,
        action_type: params.actionType,
        input_data: params.inputData,
        output_data: params.outputData,
        status: params.status,
        duration_ms: params.durationMs,
        model_used: params.modelUsed ?? this.defaultModel,
        error_message: params.errorMessage,
        started_at: new Date().toISOString(),
        completed_at: params.status === 'completed' || params.status === 'failed'
          ? new Date().toISOString()
          : undefined,
      })
      .select('id')
      .single()
    return data?.id ?? ''
  }

  protected async enqueueJob(jobType: string, payload: Record<string, unknown>, priority = 5): Promise<void> {
    const supabase = await createServiceClient()
    await supabase.from('agent_queue').insert({ job_type: jobType, payload, priority })
  }

  protected async createApproval(params: {
    companyId?: string
    contactId?: string
    approvalLevel: 'L2' | 'L3'
    approvalType: string
    title: string
    description?: string
    actionPayload: Record<string, unknown>
    riskLevel?: string
    estimatedValue?: number
  }): Promise<void> {
    const supabase = await createServiceClient()
    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString()
    await supabase.from('approvals').insert({
      company_id: params.companyId,
      contact_id: params.contactId,
      approval_level: params.approvalLevel,
      approval_type: params.approvalType,
      title: params.title,
      description: params.description,
      action_payload: params.actionPayload,
      risk_level: params.riskLevel ?? 'medium',
      estimated_value: params.estimatedValue,
      requested_by: 'ai',
      expires_at: expiresAt,
    })

    // Ping the team so they can review on mobile
    await notify({
      title: `Approval needed: ${params.title}`,
      body:  params.description ?? `${params.approvalType} · ${params.riskLevel ?? 'medium'} risk`,
      url:   '/approvals',
      priority: params.approvalLevel === 'L3' ? 'high' : 'normal',
    })
  }
}
