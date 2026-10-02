import express from 'express'
import { toNodeHandler } from 'better-auth/node'
import type { HealthResponse } from '@helpdesk/shared'
import { auth } from './auth.js'
import { prisma } from './db.js'
import { requireAuth } from './middleware/auth.js'

export const app = express()

// Better Auth parses its own bodies, so it must be mounted before express.json().
app.all('/api/auth/*splat', toNodeHandler(auth))

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

app.get('/api/me', requireAuth, (_req, res) => {
  res.json({ user: res.locals.user, session: res.locals.session })
})
