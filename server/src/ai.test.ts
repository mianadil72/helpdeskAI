import { APICallError, RetryError } from 'ai'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { describeAiError, isAiConfigured, polishReply } from './ai.js'

const generateText = vi.hoisted(() => vi.fn())

// Only generateText is replaced, so the error classes stay real.
vi.mock('ai', async (importOriginal) => ({ ...(await importOriginal<typeof import('ai')>()), generateText }))

describe('polishReply', () => {
  const input = { draft: 'try reset pw', subject: "Can't log in", lastInbound: 'Still broken', agentName: 'Sam Agent' }

  beforeEach(() => {
    generateText.mockReset()
  })

  it('asks gpt-5-nano, with minimal reasoning, to polish the draft in context', async () => {
    generateText.mockResolvedValue({ text: 'Please reset your password.' })

    await polishReply(input)

    expect(generateText).toHaveBeenCalledTimes(1)
    const call = generateText.mock.calls[0][0]
    expect(call.model.modelId).toBe('gpt-5-nano')
    expect(call.providerOptions).toEqual({ openai: { reasoningEffort: 'minimal' } })
    expect(call.system).toMatch(/Do not add information/)
    expect(call.system).toMatch(/Never use placeholders such as \[Your Name\]/)
    expect(call.prompt).toBe(
      [
        "Ticket subject: Can't log in",
        "Agent's name: Sam Agent",
        'Student\'s latest message:\n"""\nStill broken\n"""',
        'Agent\'s draft reply:\n"""\ntry reset pw\n"""',
      ].join('\n\n'),
    )
  })

  it("leaves the student's message out when there is none", async () => {
    generateText.mockResolvedValue({ text: 'Hello.' })

    await polishReply({ ...input, lastInbound: null })

    expect(generateText.mock.calls[0][0].prompt).not.toMatch(/Student's latest message/)
  })

  it('replaces every name placeholder variant, in any case', async () => {
    generateText.mockResolvedValue({
      text: 'Thanks, [your name]. [Agent Name] / [agent_name] / [Agent\'s Name] / [Your Name]',
    })

    expect(await polishReply(input)).toBe('Thanks, Sam Agent. Sam Agent / Sam Agent / Sam Agent / Sam Agent')
  })

  it('keeps other bracketed text', async () => {
    generateText.mockResolvedValue({ text: 'See [the reset page] or [Student Name].' })
    expect(await polishReply(input)).toBe('See [the reset page] or [Student Name].')
  })

  it('passes AI SDK errors on to the caller', async () => {
    const error = new Error('network down')
    generateText.mockRejectedValue(error)
    await expect(polishReply(input)).rejects.toBe(error)
  })

  it("gives the model the agent's name and replaces leftover name placeholders", async () => {
    generateText.mockResolvedValue({ text: '  Please reset your password.\n\nBest,\n[Your Name]  ' })

    expect(await polishReply(input)).toBe('Please reset your password.\n\nBest,\nSam Agent')
    expect(generateText.mock.calls[0][0].prompt).toContain("Agent's name: Sam Agent")
  })

  it('throws on an empty reply', async () => {
    generateText.mockResolvedValue({ text: '   ' })
    await expect(polishReply(input)).rejects.toThrow('The model returned an empty reply')
  })
})

describe('isAiConfigured', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('is true only when OPENAI_API_KEY is set', () => {
    vi.stubEnv('OPENAI_API_KEY', 'sk-test')
    expect(isAiConfigured()).toBe(true)
    vi.stubEnv('OPENAI_API_KEY', '')
    expect(isAiConfigured()).toBe(false)
  })
})

function apiError(statusCode: number | undefined, data?: unknown) {
  return new APICallError({
    message: 'failed',
    url: 'https://api.openai.com/v1/responses',
    requestBodyValues: {},
    statusCode,
    data,
  })
}

describe('describeAiError', () => {
  it('explains an account out of credits, also after retries', () => {
    const error = apiError(429, { error: { type: 'insufficient_quota', code: 'credit_balance_exhausted' } })
    const wrapped = new RetryError({ message: 'Failed after 3 attempts', reason: 'maxRetriesExceeded', errors: [error] })

    expect(describeAiError(error)).toBe('The AI provider account is out of credits. Ask an admin to add credits.')
    expect(describeAiError(wrapped)).toBe('The AI provider account is out of credits. Ask an admin to add credits.')
    // OpenAI has reported it as either the type or the code.
    expect(describeAiError(apiError(429, { error: { code: 'insufficient_quota' } }))).toMatch(/out of credits/)
  })

  it('treats a model the account cannot use as unavailable', () => {
    expect(describeAiError(apiError(403))).toBe('The AI model is not available to this account.')
  })

  it('explains other provider errors by status', () => {
    expect(describeAiError(apiError(401))).toMatch(/rejected the API key/)
    expect(describeAiError(apiError(404))).toBe('The AI model is not available to this account.')
    expect(describeAiError(apiError(429))).toMatch(/rate limit/)
    expect(describeAiError(apiError(500))).toBe('The AI provider returned an error. Try again in a moment.')
    expect(describeAiError(apiError(undefined))).toMatch(/could not be reached/)
  })

  it('covers errors that are not API calls', () => {
    expect(describeAiError(new Error('The model returned an empty reply'))).toMatch(/unusable reply/)
  })
})
