// Creates the initial admin from ADMIN_EMAIL / ADMIN_PASSWORD. Safe to rerun.
import { auth } from './auth.js'
import { prisma } from './db.js'

const email = process.env.ADMIN_EMAIL?.toLowerCase()
const password = process.env.ADMIN_PASSWORD
const name = process.env.ADMIN_NAME ?? 'Admin'

if (!email || !password) {
  throw new Error('ADMIN_EMAIL and ADMIN_PASSWORD must be set (see server/.env.example)')
}

const ctx = await auth.$context

if (await ctx.internalAdapter.findUserByEmail(email)) {
  console.log(`Admin ${email} already exists; skipping`)
} else {
  const user = await ctx.internalAdapter.createUser(
    { email, name, role: 'admin', emailVerified: true },
    { method: 'admin' },
  )
  await ctx.internalAdapter.linkAccount({
    userId: user.id,
    providerId: 'credential',
    accountId: user.id,
    password: await ctx.password.hash(password),
  })
  console.log(`Created admin ${email}`)
}

await prisma.$disconnect()
