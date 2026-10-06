import { Navigate, Outlet } from 'react-router'
import { authClient } from '@/lib/auth-client'

// Gate for admin-only routes; nest inside RequireAuth. Non-admins go home.
export function RequireAdmin() {
  const { data: session, isPending } = authClient.useSession()

  if (isPending) {
    return <p className="p-8 text-sm text-muted-foreground">Loading…</p>
  }
  if (session?.user.role !== 'admin') return <Navigate to="/" replace />
  return <Outlet />
}
