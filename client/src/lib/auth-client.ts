import { createAuthClient } from 'better-auth/react'
import { inferAdditionalFields } from 'better-auth/client/plugins'

// No baseURL: requests go to the same origin under /api/auth, which Vite
// proxies to the server in dev, so the session cookie stays first-party.
// inferAdditionalFields mirrors the server's extra user fields so
// `session.user.role` is typed on the client.
export const authClient = createAuthClient({
  plugins: [inferAdditionalFields({ user: { role: { type: 'string' } } })],
})
