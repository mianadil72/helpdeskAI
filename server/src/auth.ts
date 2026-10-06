import { betterAuth } from 'better-auth'
import { prismaAdapter } from 'better-auth/adapters/prisma'
import { prisma } from './db.js'

// Better Auth falls back to a public default secret when this is missing
// (and only refuses outside production), so fail fast in every environment.
const secret = process.env.BETTER_AUTH_SECRET
if (!secret || secret.length < 32) {
  throw new Error(
    'BETTER_AUTH_SECRET must be at least 32 characters (generate one with `openssl rand -base64 32`)',
  )
}

// Sessions are stored in the `session` table; the browser only gets an opaque,
// httpOnly session cookie. Public sign-up is disabled: users are created
// server-side (seed script, later the admin user-management API).
export const auth = betterAuth({
  secret,
  database: prismaAdapter(prisma, { provider: 'postgresql' }),
  // On regardless of NODE_ENV (Better Auth enables it only in production).
  // Keyed on X-Forwarded-For, which app.ts overwrites with Express's req.ip.
  rateLimit: {
    enabled: true,
    customRules: { '/sign-in/email': { window: 60, max: 5 } },
  },
  emailAndPassword: { enabled: true, disableSignUp: true },
  user: {
    additionalFields: {
      role: { type: 'string', defaultValue: 'agent', input: false },
    },
  },
  trustedOrigins: process.env.TRUSTED_ORIGINS?.split(',').map((o) => o.trim()) ?? [],
})
