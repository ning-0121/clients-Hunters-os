/**
 * buildBrief — composes the full Customer Intelligence Brief from existing data.
 * PURE and deterministic: same inputs → same brief. No LLM, no I/O.
 */
import type { BriefInputs, IntelligenceBrief } from '@/lib/intel/types'
import { BRIEF_VERSION } from '@/lib/intel/types'
import { classifyCustomerType } from '@/lib/intel/customer-type'
import { inferPurchasingModel } from '@/lib/intel/purchasing-model'
import { productSupplyFit } from '@/lib/intel/product-fit'
import { buildDecisionChain } from '@/lib/intel/decision-chain'
import { buildContactStrategy } from '@/lib/intel/contact-strategy'
import { buildWinningStrategy } from '@/lib/intel/winning-strategy'
import { buildExecutiveDecision } from '@/lib/intel/executive-decision'
import { buildResourceAllocation } from '@/lib/intel/resource-allocation'
import { buildRiskAssessment } from '@/lib/intel/risks'
import { buildNextActions } from '@/lib/intel/next-actions'
import { buildAccountProfile } from '@/lib/intel/account-profile'

export function buildBrief(inputs: BriefInputs): IntelligenceBrief {
  const { company, contacts, access } = inputs

  const accountProfile = buildAccountProfile(company)
  const customerType = classifyCustomerType(company)
  const purchasingModel = inferPurchasingModel(inputs, customerType.type)
  const productFit = productSupplyFit(company, customerType.type)
  const decisionChain = buildDecisionChain(contacts, access, customerType)
  const executive = buildExecutiveDecision(company, customerType, access, productFit.qimoFitScore)
  const winningStrategy = buildWinningStrategy(customerType.type, productFit)
  const contactStrategy = buildContactStrategy(customerType.type, decisionChain)
  const risk = buildRiskAssessment(company, customerType.type, executive, productFit, access)
  const resource = buildResourceAllocation(executive, access)
  const nextActions = buildNextActions(
    company.name, executive, customerType.type, productFit, decisionChain, contactStrategy, winningStrategy, resource,
  )

  return {
    version: BRIEF_VERSION,
    accountProfile,
    executive,
    customerType,
    purchasingModel,
    productFit,
    decisionChain,
    contactStrategy,
    winningStrategy,
    risk,
    resource,
    nextActions,
  }
}
