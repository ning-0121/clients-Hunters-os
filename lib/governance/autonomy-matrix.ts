import type { Grade } from '@/types'

export type AutonomyMode = 'auto' | 'semi' | 'manual'

export interface AutonomyDecision {
  mode: AutonomyMode
  requiresApproval: boolean
  approver: 'none' | 'sales' | 'boss'
  reason: string
}

const MATRIX: Record<string, Record<Grade, AutonomyDecision>> = {
  lead_discovery: {
    A: { mode: 'semi',   requiresApproval: true,  approver: 'sales', reason: 'VIP lead requires human confirmation' },
    B: { mode: 'auto',   requiresApproval: false, approver: 'none',  reason: 'Auto discover and queue for review' },
    C: { mode: 'auto',   requiresApproval: false, approver: 'none',  reason: 'Fully automated' },
    D: { mode: 'manual', requiresApproval: false, approver: 'none',  reason: 'Low value — skip' },
  },
  enrich: {
    A: { mode: 'auto',   requiresApproval: false, approver: 'none',  reason: 'Always enrich' },
    B: { mode: 'auto',   requiresApproval: false, approver: 'none',  reason: 'Always enrich' },
    C: { mode: 'auto',   requiresApproval: false, approver: 'none',  reason: 'Always enrich' },
    D: { mode: 'manual', requiresApproval: false, approver: 'none',  reason: 'Skip D-grade enrichment' },
  },
  email_first_touch: {
    A: { mode: 'semi',   requiresApproval: true,  approver: 'boss',  reason: 'VIP first touch must be human-reviewed' },
    B: { mode: 'semi',   requiresApproval: true,  approver: 'sales', reason: 'Sales confirms before sending' },
    C: { mode: 'auto',   requiresApproval: false, approver: 'none',  reason: 'Auto send' },
    D: { mode: 'manual', requiresApproval: false, approver: 'none',  reason: 'Skip' },
  },
  whatsapp: {
    A: { mode: 'manual', requiresApproval: true,  approver: 'boss',  reason: 'Human operated for VIPs' },
    B: { mode: 'semi',   requiresApproval: true,  approver: 'sales', reason: 'AI drafts, sales sends' },
    C: { mode: 'semi',   requiresApproval: true,  approver: 'sales', reason: 'Always needs approval' },
    D: { mode: 'manual', requiresApproval: false, approver: 'none',  reason: 'Skip' },
  },
  catalog_send: {
    A: { mode: 'manual', requiresApproval: true,  approver: 'boss',  reason: 'Human decides timing and version' },
    B: { mode: 'semi',   requiresApproval: true,  approver: 'sales', reason: 'Sales confirms catalog version' },
    C: { mode: 'semi',   requiresApproval: true,  approver: 'sales', reason: 'Requires approval' },
    D: { mode: 'manual', requiresApproval: false, approver: 'none',  reason: 'Skip' },
  },
  sample_offer: {
    A: { mode: 'manual', requiresApproval: true,  approver: 'boss',  reason: 'Boss approves VIP samples' },
    B: { mode: 'semi',   requiresApproval: true,  approver: 'sales', reason: 'Sales decides sample type' },
    C: { mode: 'semi',   requiresApproval: true,  approver: 'sales', reason: 'Requires approval' },
    D: { mode: 'manual', requiresApproval: false, approver: 'none',  reason: 'Skip' },
  },
  negotiation: {
    A: { mode: 'manual', requiresApproval: false, approver: 'boss',  reason: 'Human leads, AI advises' },
    B: { mode: 'semi',   requiresApproval: false, approver: 'sales', reason: 'Human leads with AI data' },
    C: { mode: 'auto',   requiresApproval: false, approver: 'none',  reason: 'N/A for C-grade' },
    D: { mode: 'manual', requiresApproval: false, approver: 'none',  reason: 'N/A' },
  },
  mark_lost: {
    A: { mode: 'manual', requiresApproval: true,  approver: 'boss',  reason: 'Boss must decide on VIP loss' },
    B: { mode: 'semi',   requiresApproval: true,  approver: 'sales', reason: 'Sales confirms loss' },
    C: { mode: 'auto',   requiresApproval: false, approver: 'none',  reason: 'Auto after 30 days no reply' },
    D: { mode: 'auto',   requiresApproval: false, approver: 'none',  reason: 'Auto discard' },
  },
}

export function getAutonomyDecision(action: string, grade: Grade): AutonomyDecision {
  const actionMatrix = MATRIX[action]
  if (!actionMatrix) {
    return { mode: 'semi', requiresApproval: true, approver: 'sales', reason: 'Unknown action — default to approval' }
  }
  return actionMatrix[grade]
}
