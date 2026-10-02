import type { ReactNode } from 'react'

// Top bar shared by the login page and the signed-in layout; `children`
// fills the right-hand side (e.g. the current user and Sign out).
export function AppHeader({ children }: { children?: ReactNode }) {
  return (
    <header className="border-b">
      <nav className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
        <span className="font-semibold">Helpdesk</span>
        {children && <div className="flex items-center gap-3">{children}</div>}
      </nav>
    </header>
  )
}
