import { APICallError, RetryError } from 'ai'
import { describe, expect, it, vi } from 'vitest'
import { describeAiError, polishReply } from './ai.js'

const generateText = vi.hoisted(() => vi.fn())

// Only generateText is replaced, so the error classes stay real.
vi.mock('ai', async (importOriginal) => ({ ...(await importOriginal<typeof import('ai')>()), generateText }))

describe('polishReply', () => {
  const input = { draft: 'try reset pw', subject: "Can't log in", lastInbound: 'Still broken', agentName: 'Sam Agent' }

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
