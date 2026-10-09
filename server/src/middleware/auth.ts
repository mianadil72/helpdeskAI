import type { RequestHandler } from 'express'
import { fromNodeHeaders } from 'better-auth/node'
import { auth } from '../auth.js'

export type AuthSession = typeof auth.$Infer.Session

// Looks up the session in the database; 401 if missing or expired.
export const requireAuth: RequestHandler = async (req, res, next) => {
  const result = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) })
  if (!result) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }
  res.locals.user = result.user
  res.locals.session = result.session
  next()
}

// Admin-only gate; use after requireAuth. 403 for signed-in non-admins.
export const requireAdmin: RequestHandler = (_req, res, next) => {
  const { user } = res.locals as AuthSession
  if (user.role !== 'admin') {
    res.status(403).json({ error: 'Forbidden' })
    return
  }
  next()
}
