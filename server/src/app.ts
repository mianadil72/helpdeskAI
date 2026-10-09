import express, { type ErrorRequestHandler } from 'express'
import { toNodeHandler } from 'better-auth/node'
import type { HealthResponse } from '@helpdesk/shared'
import { auth } from './auth.js'
import { prisma } from './db.js'
import { requireAuth, type AuthSession } from './middleware/auth.js'
import { usersRouter } from './routes/users.js'

export const app = express()

app.disable('x-powered-by')

// Which proxy hops to trust for req.ip (e.g. `1` behind one reverse proxy);
// unset means trust none and use the socket address.
const trustProxy = process.env.TRUST_PROXY
if (trustProxy) {
  app.set('trust proxy', /^\d+$/.test(trustProxy) ? Number(trustProxy) : trustProxy)
}

// Better Auth rate-limits by X-Forwarded-For, which clients can forge. Replace
// it with req.ip, which only honours forwarded headers from trusted proxies.
// Better Auth parses its own bodies, so it must be mounted before express.json().
app.all('/api/auth/*splat', (req, _res, next) => {
  req.headers['x-forwarded-for'] = req.ip
  next()
}, toNodeHandler(auth))

app.use(express.json())

app.get('/api/health', async (_req, res) => {
  let database: HealthResponse['database'] = 'ok'
  try {
    await prisma.$queryRaw`SELECT 1`
  } catch {
    database = 'error'
  }

  const body: HealthResponse = {
    status: database === 'ok' ? 'ok' : 'error',
    database,
    timestamp: new Date().toISOString(),
  }
  res.status(body.status === 'ok' ? 200 : 503).json(body)
})

// Only what the client needs; the session token stays in the httpOnly cookie.
app.get('/api/me', requireAuth, (_req, res) => {
  const { user, session } = res.locals as AuthSession
  res.json({
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
    session: { expiresAt: session.expiresAt },
  })
})

app.use('/api/users', usersRouter)

// Last: replaces Express's default handler, which sends stack traces outside
// production. Client errors (e.g. malformed JSON) keep their 4xx status.
const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  const status = Number(err?.status ?? err?.statusCode)
  if (status >= 400 && status < 500) {
    res.status(status).json({ error: 'Bad request' })
    return
  }
  console.error(err)
  res.status(500).json({ error: 'Internal server error' })
}
app.use(errorHandler)
