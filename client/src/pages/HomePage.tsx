import { useEffect, useState } from 'react'
import type { HealthResponse } from '@helpdesk/shared'

export function HomePage() {
  const [health, setHealth] = useState<HealthResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/health')
      .then((res) => {
        if (!res.ok && res.status !== 503) throw new Error(`HTTP ${res.status}`)
        return res.json() as Promise<HealthResponse>
      })
      .then(setHealth)
      .catch((err: Error) => setError(err.message))
  }, [])

  return (
    <div className="flex flex-col gap-2">
      <h1 className="text-2xl font-semibold">Home</h1>
      {error && <p>API error: {error}</p>}
      {!error && !health && <p>Checking API…</p>}
      {health && (
        <p className="text-sm text-muted-foreground">
          API: {health.status} · Database: {health.database}
        </p>
      )}
    </div>
  )
}
