import { betterAuth } from 'better-auth'
import { prismaAdapter } from 'better-auth/adapters/prisma'
import { prisma } from './db.js'

// Sessions are stored in the `session` table; the browser only gets an opaque,
// httpOnly session cookie. Public sign-up is disabled: users are created
// server-side (seed script, later the admin user-management API).
export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: 'postgresql' }),
  emailAndPassword: { enabled: true, disableSignUp: true },
  user: {
    additionalFields: {
      role: { type: 'string', defaultValue: 'agent', input: false },
    },
  },
  trustedOrigins: process.env.TRUSTED_ORIGINS?.split(',').map((o) => o.trim()) ?? [],
})
