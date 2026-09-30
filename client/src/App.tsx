import { useEffect, useState } from 'react'
import type { HealthResponse } from '@helpdesk/shared'

function App() {
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
    <main>
      <h1>Helpdesk</h1>
      {error && <p>API error: {error}</p>}
      {!error && !health && <p>Checking API…</p>}
      {health && (
        <>
          <p>API status: {health.status}</p>
          <p>Database: {health.database}</p>
        </>
      )}
    </main>
  )
}

export default App
