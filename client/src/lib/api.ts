// Error from our API; `status` lets callers (e.g. query retry) tell 4xx from 5xx.
export class ApiError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

// Requests go same-origin via the Vite proxy, so the session cookie is sent.
// Throws ApiError with the server's `error` message on non-2xx responses.
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init)
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null
    throw new ApiError(body?.error ?? `HTTP ${res.status}`, res.status)
  }
  // 204 No Content (e.g. DELETE) has no body to parse.
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

// GET a JSON endpoint on our API.
export function apiGet<T>(path: string): Promise<T> {
  return request<T>(path)
}

// POST a JSON body to our API.
export function apiPost<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

// PATCH a JSON body to our API.
export function apiPatch<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

// DELETE a resource on our API.
export function apiDelete(path: string): Promise<void> {
  return request<void>(path, { method: 'DELETE' })
}
