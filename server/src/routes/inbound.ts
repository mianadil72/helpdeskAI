import { createHash, timingSafeEqual } from 'node:crypto'
import express, { Router, type RequestHandler } from 'express'
import { z } from 'zod'
import { inboundEmailSchema } from '@helpdesk/shared'
import { receiveInboundEmail } from '../inbound-email.js'

// Receives support emails from whatever delivers them (no email provider yet;
// later a provider adapter or mailbox poller). Callers are machines, not
// users, so they authenticate with a shared secret instead of a session.
export const inboundRouter = Router()

// Emails are bigger than express.json()'s 100 kB default, so app.ts mounts
// this router before the global parser.
inboundRouter.use(requireInboundSecret(), express.json({ limit: '5mb' }))

// Created tickets get 201; everything else is 200 so a sender doesn't retry.
inboundRouter.post('/email', async (req, res) => {
  const parsed = inboundEmailSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid input', fields: z.flattenError(parsed.error).fieldErrors })
    return
  }

  const body = await receiveInboundEmail(parsed.data)
  res.status(body.result === 'created' ? 201 : 200).json(body)
})

// `Authorization: Bearer <INBOUND_EMAIL_SECRET>`. Read per request so tests can
// change it; unset disables the endpoint.
function requireInboundSecret(): RequestHandler {
  return (req, res, next) => {
    const secret = process.env.INBOUND_EMAIL_SECRET
    if (!secret) {
      res.status(503).json({ error: 'Inbound email is not configured' })
      return
    }
    const given = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1] ?? ''
    // Hash both so timingSafeEqual gets equal lengths and leaks nothing about them.
    const digest = (value: string) => createHash('sha256').update(value).digest()
    if (!timingSafeEqual(digest(given), digest(secret))) {
      res.status(401).json({ error: 'Unauthorized' })
      return
    }
    next()
  }
}
