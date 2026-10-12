import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, apiGet, apiPost } from './api'

const fetchMock = vi.fn<typeof fetch>()

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  fetchMock.mockReset()
})

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('apiGet', () => {
  it('returns the parsed JSON body', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ users: [] }))

    await expect(apiGet('/api/users')).resolves.toEqual({ users: [] })
    expect(fetchMock).toHaveBeenCalledWith('/api/users', undefined)
  })
})

describe('apiPost', () => {
  it('sends the body as JSON and returns the parsed response', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ user: { id: '1' } }, 201))

    await expect(apiPost('/api/users', { name: 'Jane' })).resolves.toEqual({ user: { id: '1' } })
    expect(fetchMock).toHaveBeenCalledWith('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Jane' }),
    })
  })

  it("throws ApiError with the server's error message and status", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: 'A user with this email already exists' }, 409))

    const error = await apiPost('/api/users', {}).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ message: 'A user with this email already exists', status: 409 })
  })

  it('falls back to the HTTP status when the error body is not JSON', async () => {
    fetchMock.mockResolvedValue(new Response('Bad gateway', { status: 502 }))

    await expect(apiPost('/api/users', {})).rejects.toMatchObject({ message: 'HTTP 502', status: 502 })
  })
})
