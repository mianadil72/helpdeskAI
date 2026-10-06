import { Link, Outlet, useNavigate } from 'react-router'
import { AppHeader } from '@/components/AppHeader'
import { Button } from '@/components/ui/button'
import { authClient } from '@/lib/auth-client'

export function AppLayout() {
  const navigate = useNavigate()
  const { data: session } = authClient.useSession()

  async function handleSignOut() {
    await authClient.signOut()
    navigate('/login', { replace: true })
  }

  return (
    <div className="min-h-svh">
      <AppHeader>
        {session?.user.role === 'admin' && (
          <Button variant="ghost" size="sm" asChild>
            <Link to="/users">Users</Link>
          </Button>
        )}
        <span className="text-sm">{session?.user.name}</span>
        <Button variant="outline" size="sm" onClick={handleSignOut}>
          Sign out
        </Button>
      </AppHeader>
      <main className="mx-auto max-w-5xl p-4">
        <Outlet />
      </main>
    </div>
  )
}
