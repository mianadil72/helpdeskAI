import { Router } from 'express'
import { z } from 'zod'
import {
  createUserSchema,
  updateUserSchema,
  type CreateUserResponse,
  type UpdateUserResponse,
  type UserListItem,
  type UsersResponse,
} from '@helpdesk/shared'
import { auth } from '../auth.js'
import { prisma } from '../db.js'
import { requireAdmin, requireAuth, type AuthSession } from '../middleware/auth.js'

// User management; every route is admin-only.
export const usersRouter = Router()

usersRouter.use(requireAuth, requireAdmin)

// Explicit select: never send password hashes or session data.
const userSelect = { id: true, name: true, email: true, role: true, createdAt: true } as const

function toUserListItem(user: { id: string; name: string; email: string; role: string; createdAt: Date }): UserListItem {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    // `role` is a plain string column; anything but 'admin' is an agent.
    role: user.role === 'admin' ? 'admin' : 'agent',
    createdAt: user.createdAt.toISOString(),
  }
}

usersRouter.get('/', async (_req, res) => {
  const users = await prisma.user.findMany({
    where: { deletedAt: null },
    select: userSelect,
    orderBy: { createdAt: 'asc' },
  })

  const body: UsersResponse = { users: users.map(toUserListItem) }
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

  // Deleted users keep their row (and email), so their email stays taken.
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

  const body: CreateUserResponse = { user: toUserListItem({ ...user, role: 'agent' }) }
  res.status(201).json(body)
})

// Edits a user's name and email, and replaces their password when one is given.
// The role can't be changed here.
usersRouter.patch('/:id', async (req, res) => {
  const parsed = updateUserSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid input', fields: z.flattenError(parsed.error).fieldErrors })
    return
  }
  const { name, email, password } = parsed.data
  const { id } = req.params

  if (!(await prisma.user.findFirst({ where: { id, deletedAt: null }, select: { id: true } }))) {
    res.status(404).json({ error: 'User not found' })
    return
  }

  const ctx = await auth.$context
  const sameEmail = await ctx.internalAdapter.findUserByEmail(email)
  if (sameEmail && sameEmail.user.id !== id) {
    res.status(409).json({ error: 'A user with this email already exists' })
    return
  }

  const user = await prisma.user.update({ where: { id }, data: { name, email }, select: userSelect })
  if (password) {
    await ctx.internalAdapter.updatePassword(id, await ctx.password.hash(password))
  }

  const body: UpdateUserResponse = { user: toUserListItem(user) }
  res.json(body)
})

// Soft-deletes a user: the row is kept with `deletedAt` set (so records that
// reference them, like tickets, stay intact), they disappear from the list and
// can't sign in again (see the session hook in auth.ts), and their sessions are
// removed so they are signed out everywhere. Admins can't delete themselves,
// which also means at least one admin always remains.
usersRouter.delete('/:id', async (req, res) => {
  const { id } = req.params
  const { user: me } = res.locals as AuthSession
  if (id === me.id) {
    res.status(403).json({ error: "You can't delete your own account" })
    return
  }

  const [{ count }] = await prisma.$transaction([
    prisma.user.updateMany({ where: { id, deletedAt: null }, data: { deletedAt: new Date() } }),
    prisma.session.deleteMany({ where: { userId: id } }),
  ])
  if (count === 0) {
    res.status(404).json({ error: 'User not found' })
    return
  }
  res.status(204).end()
})
