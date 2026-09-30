import express from 'express'
import type { HealthResponse } from '@helpdesk/shared'
import { prisma } from './db.js'

export const app = express()

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
