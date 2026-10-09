// GET a JSON endpoint on our API (same origin via the Vite proxy, so the
// session cookie is sent). Throws with the server's `error` message on failure.
export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(path)
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null
    throw new Error(body?.error ?? `HTTP ${res.status}`)
  }
  return res.json() as Promise<T>
}
