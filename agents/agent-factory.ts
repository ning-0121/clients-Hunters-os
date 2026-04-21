import { ScoreAgent } from '@/agents/score/score-agent'
import { OutreachAgent } from '@/agents/outreach/outreach-agent'
import { DiscoveryAgent } from '@/agents/discovery/discovery-agent'
import { EnrichAgent } from '@/agents/enrich/enrich-agent'
import type { BaseAgent } from '@/agents/base-agent'

const registry: Record<string, () => BaseAgent> = {
  run_discovery:  () => new DiscoveryAgent(),
  enrich_company: () => new EnrichAgent(),
  score_company:  () => new ScoreAgent(),
  draft_outreach: () => new OutreachAgent(),
}

export class AgentFactory {
  static create(jobType: string): BaseAgent {
    const factory = registry[jobType]
    if (!factory) throw new Error(`Unknown job type: ${jobType}`)
    return factory()
  }

  static canHandle(jobType: string): boolean {
    return jobType in registry
  }
}
