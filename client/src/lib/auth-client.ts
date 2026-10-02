import { createAuthClient } from 'better-auth/react'

// No baseURL: requests go to the same origin under /api/auth, which Vite
// proxies to the server in dev, so the session cookie stays first-party.
export const authClient = createAuthClient()
