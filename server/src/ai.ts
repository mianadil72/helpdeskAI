import { openai, type OpenAILanguageModelResponsesOptions } from '@ai-sdk/openai'
import { APICallError, RetryError, generateText } from 'ai'

// AI helpers. Calls go through the Vercel AI SDK, so switching provider or
// model only touches this file. The default `openai` provider reads
// OPENAI_API_KEY from the environment.
const POLISH_MODEL = 'gpt-5-nano'

const POLISH_SYSTEM = `You edit replies that support agents write to students.
Improve the agent's draft: fix grammar and spelling, make it clear and concise, and keep a friendly, professional tone.
Keep the meaning, facts, links, numbers, names and any promises exactly as written. Do not add information, steps or offers that are not in the draft.
Use the student's message only to understand the context.
If the reply has a sign-off, sign it with the agent's name given below. Never use placeholders such as [Your Name].
Return only the improved reply as plain text: no Markdown, no subject line, no notes about your changes.`

export function isAiConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY)
}

export interface PolishReplyInput {
  draft: string
  subject: string
  // The student's latest message, if any, for context.
  lastInbound: string | null
  // Name to sign the reply with.
  agentName: string
}

// Placeholders the model may still write for the agent's name.
const NAME_PLACEHOLDER = /\[(?:your|agent(?:'s)?)[ _]name\]/gi

// Returns an improved version of the agent's draft. Throws if the call fails
// or the model returns nothing.
export async function polishReply({ draft, subject, lastInbound, agentName }: PolishReplyInput): Promise<string> {
  const prompt = [
    `Ticket subject: ${subject}`,
    `Agent's name: ${agentName}`,
    lastInbound && `Student's latest message:\n"""\n${lastInbound}\n"""`,
    `Agent's draft reply:\n"""\n${draft}\n"""`,
  ]
    .filter(Boolean)
    .join('\n\n')

  const { text } = await generateText({
    model: openai(POLISH_MODEL),
    system: POLISH_SYSTEM,
    prompt,
    providerOptions: {
      openai: { reasoningEffort: 'minimal' } satisfies OpenAILanguageModelResponsesOptions,
    },
  })

  const polished = text.replace(NAME_PLACEHOLDER, agentName).trim()
  if (!polished) throw new Error('The model returned an empty reply')
  return polished
}

// A message for agents saying why an AI call failed, without provider
// internals. The full error still goes to the server log.
export function describeAiError(err: unknown): string {
  // After retries, the SDK wraps the provider's error.
  const cause = RetryError.isInstance(err) ? err.lastError : err
  if (!APICallError.isInstance(cause)) return 'The AI provider returned an unusable reply. Try again in a moment.'

  const { type, code } = (cause.data as { error?: { type?: string; code?: string } } | undefined)?.error ?? {}
  if (type === 'insufficient_quota' || code === 'insufficient_quota' || code === 'credit_balance_exhausted') {
    return 'The AI provider account is out of credits. Ask an admin to add credits.'
  }
  switch (cause.statusCode) {
    case undefined:
      // No HTTP response: network failure or timeout.
      return 'The AI provider could not be reached. Try again in a moment.'
    case 401:
      return 'The AI provider rejected the API key. Ask an admin to check OPENAI_API_KEY.'
    case 403:
    case 404:
      return 'The AI model is not available to this account.'
    case 429:
      return 'The AI provider is busy (rate limit). Try again in a moment.'
    default:
      return 'The AI provider returned an error. Try again in a moment.'
  }
}
