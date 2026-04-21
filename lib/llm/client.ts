import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'

export type LLMProvider = 'claude' | 'openai'

export interface LLMMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface LLMOptions {
  provider?: LLMProvider
  model?: string
  maxTokens?: number
  temperature?: number
  systemPrompt?: string
}

const DEFAULT_MODELS = {
  claude: 'claude-sonnet-4-6',
  openai: 'gpt-4o',
}

// Create fresh client each call to ensure env vars are read at request time
// (avoids module-level singleton reading vars before Next.js injects them)
function getAnthropic() {
  // Use ARAOS_ANTHROPIC_API_KEY to avoid conflict with Claude Code's shell env var
  const apiKey = process.env.ARAOS_ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ARAOS_ANTHROPIC_API_KEY is not set in .env.local')
  return new Anthropic({ apiKey })
}

function getOpenAI() {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error('OPENAI_API_KEY is not set in .env.local')
  return new OpenAI({ apiKey })
}

export async function callLLM(
  messages: LLMMessage[],
  options: LLMOptions = {}
): Promise<string> {
  const {
    provider = 'claude',
    model,
    maxTokens = 2048,
    temperature = 0.7,
    systemPrompt,
  } = options

  if (provider === 'claude') {
    const client = getAnthropic()
    const response = await client.messages.create({
      model: model ?? DEFAULT_MODELS.claude,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
    })
    const block = response.content[0]
    return block.type === 'text' ? block.text : ''
  }

  if (provider === 'openai') {
    const client = getOpenAI()
    const allMessages: OpenAI.Chat.ChatCompletionMessageParam[] = []
    if (systemPrompt) allMessages.push({ role: 'system', content: systemPrompt })
    allMessages.push(...messages.map((m) => ({ role: m.role, content: m.content })))

    const response = await client.chat.completions.create({
      model: model ?? DEFAULT_MODELS.openai,
      max_tokens: maxTokens,
      temperature,
      messages: allMessages,
    })
    return response.choices[0]?.message?.content ?? ''
  }

  throw new Error(`Unsupported LLM provider: ${provider}`)
}

export async function callLLMSimple(
  systemPrompt: string,
  userMessage: string,
  options?: Omit<LLMOptions, 'systemPrompt'>
): Promise<string> {
  return callLLM(
    [{ role: 'user', content: userMessage }],
    { ...options, systemPrompt }
  )
}
