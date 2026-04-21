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

let anthropicClient: Anthropic | null = null
let openaiClient: OpenAI | null = null

function getAnthropic() {
  if (!anthropicClient) {
    anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  }
  return anthropicClient
}

function getOpenAI() {
  if (!openaiClient) {
    openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  }
  return openaiClient
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
