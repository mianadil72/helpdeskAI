import { Router } from 'express'
import { z } from 'zod'
import {
  createUserSchema,
  type CreateUserResponse,
  type Role,
  type UsersResponse,
} from '@helpdesk/shared'
import { auth } from '../auth.js'
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

// Creates an agent with an email/password account. Public sign-up is disabled,
// so this goes through Better Auth's internal adapter (as the seed script does)
// to get the same password hashing and account layout.
usersRouter.post('/', async (req, res) => {
  const parsed = createUserSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid input', fields: z.flattenError(parsed.error).fieldErrors })
    return
  }
  const { name, email, password } = parsed.data

  const ctx = await auth.$context
  if (await ctx.internalAdapter.findUserByEmail(email)) {
    res.status(409).json({ error: 'A user with this email already exists' })
    return
  }

  const user = await ctx.internalAdapter.createUser(
    { name, email, role: 'agent', emailVerified: true },
    { method: 'admin' },
  )
  try {
    await ctx.internalAdapter.linkAccount({
      userId: user.id,
      providerId: 'credential',
      accountId: user.id,
      password: await ctx.password.hash(password),
    })
  } catch (err) {
    // Don't leave a user who can never sign in.
    await prisma.user.delete({ where: { id: user.id } })
    throw err
  }

  const body: CreateUserResponse = {
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: 'agent',
      createdAt: user.createdAt.toISOString(),
    },
  }
  res.status(201).json(body)
})
