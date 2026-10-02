import { Navigate, Outlet } from 'react-router'
import { authClient } from '@/lib/auth-client'

// Gate for routes that need a signed-in user; sends everyone else to /login.
export function RequireAuth() {
  const { data: session, isPending } = authClient.useSession()

  if (isPending) {
    return <p className="p-8 text-sm text-muted-foreground">Loading…</p>
  }
  if (!session) return <Navigate to="/login" replace />
  return <Outlet />
}
