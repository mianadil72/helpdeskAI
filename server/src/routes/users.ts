import { Router } from 'express'
import type { Role, UsersResponse } from '@helpdesk/shared'
import { prisma } from '../db.js'
import { requireAdmin, requireAuth } from '../middleware/auth.js'

// User management; every route is admin-only.
export const usersRouter = Router()

usersRouter.use(requireAuth, requireAdmin)

usersRouter.get('/', async (_req, res) => {
  // Explicit select: never send password hashes or session data.
  const users = await prisma.user.findMany({
    select: { id: true, name: true, email: true, role: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  })

  const body: UsersResponse = {
    users: users.map((u) => ({
      ...u,
      // `role` is a plain string column; anything but 'admin' is an agent.
      role: (u.role === 'admin' ? 'admin' : 'agent') satisfies Role,
      createdAt: u.createdAt.toISOString(),
    })),
  }
  res.json(body)
})
