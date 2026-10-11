// Error from our API; `status` lets callers (e.g. query retry) tell 4xx from 5xx.
export class ApiError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

// GET a JSON endpoint on our API (same origin via the Vite proxy, so the
// session cookie is sent). Throws ApiError with the server's `error` message.
export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(path)
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null
    throw new ApiError(body?.error ?? `HTTP ${res.status}`, res.status)
  }
  return res.json() as Promise<T>
}
