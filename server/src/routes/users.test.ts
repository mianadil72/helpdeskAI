import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { app } from '../app.js'

// Better Auth and Prisma are mocked, so these tests need no database or env.
const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  findUserByEmail: vi.fn(),
  createUser: vi.fn(),
  linkAccount: vi.fn(),
  hash: vi.fn(),
  findMany: vi.fn(),
  deleteUser: vi.fn(),
}))

vi.mock('../auth.js', () => ({
  auth: {
    handler: vi.fn(),
    api: { getSession: mocks.getSession },
    $context: Promise.resolve({
      internalAdapter: {
        findUserByEmail: mocks.findUserByEmail,
        createUser: mocks.createUser,
        linkAccount: mocks.linkAccount,
      },
      password: { hash: mocks.hash },
    }),
  },
}))

vi.mock('../db.js', () => ({
  prisma: { user: { findMany: mocks.findMany, delete: mocks.deleteUser } },
}))

const createdAt = new Date('2026-10-01T12:00:00.000Z')
const valid = { name: 'Jane Doe', email: 'jane@example.com', password: 'password123' }

function signInAs(role: 'admin' | 'agent' | null) {
  mocks.getSession.mockResolvedValue(
    role && {
      user: { id: `${role}-id`, name: role, email: `${role}@example.com`, role },
      session: { id: 'session-id', expiresAt: new Date() },
    },
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  signInAs('admin')
  mocks.findUserByEmail.mockResolvedValue(null)
  mocks.createUser.mockImplementation(async (data: { name: string; email: string }) => ({
    id: 'new-user-id',
    ...data,
    createdAt,
  }))
  mocks.hash.mockResolvedValue('hashed-password')
  mocks.linkAccount.mockResolvedValue({})
})

describe('POST /api/users', () => {
  it('creates an agent with a credential account and returns it', async () => {
    const res = await request(app).post('/api/users').send(valid)

    expect(res.status).toBe(201)
    expect(res.body).toEqual({
      user: {
        id: 'new-user-id',
        name: 'Jane Doe',
        email: 'jane@example.com',
        role: 'agent',
        createdAt: createdAt.toISOString(),
      },
    })
    expect(mocks.createUser).toHaveBeenCalledWith(
      { name: 'Jane Doe', email: 'jane@example.com', role: 'agent', emailVerified: true },
      { method: 'admin' },
    )
    expect(mocks.hash).toHaveBeenCalledWith('password123')
    expect(mocks.linkAccount).toHaveBeenCalledWith({
      userId: 'new-user-id',
      providerId: 'credential',
      accountId: 'new-user-id',
      password: 'hashed-password',
    })
  })

  it('never sends the password or its hash back', async () => {
    const res = await request(app).post('/api/users').send(valid)
    expect(JSON.stringify(res.body)).not.toMatch(/password123|hashed-password/)
  })

  it('normalises the name and email before saving', async () => {
    await request(app)
      .post('/api/users')
      .send({ ...valid, name: '  Jane Doe ', email: ' Jane@Example.COM ' })

    expect(mocks.findUserByEmail).toHaveBeenCalledWith('jane@example.com')
    expect(mocks.createUser).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Jane Doe', email: 'jane@example.com' }),
      expect.anything(),
    )
  })

  it('always creates an agent, even if the body asks for admin', async () => {
    await request(app)
      .post('/api/users')
      .send({ ...valid, role: 'admin' })

    expect(mocks.createUser).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'agent' }),
      expect.anything(),
    )
  })

  it('returns 400 with field errors for invalid input', async () => {
    const res = await request(app)
      .post('/api/users')
      .send({ name: '', email: 'bad', password: 'short' })

    expect(res.status).toBe(400)
    expect(res.body).toEqual({
      error: 'Invalid input',
      fields: {
        name: ['Name is required'],
        email: ['Enter a valid email address'],
        password: ['Password must be at least 8 characters'],
      },
    })
    expect(mocks.createUser).not.toHaveBeenCalled()
  })

  it('returns 400 for a missing body', async () => {
    const res = await request(app).post('/api/users')
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('Invalid input')
  })

  it('returns 409 when the email is already in use', async () => {
    mocks.findUserByEmail.mockResolvedValue({ user: { id: 'existing' } })

    const res = await request(app).post('/api/users').send(valid)

    expect(res.status).toBe(409)
    expect(res.body).toEqual({ error: 'A user with this email already exists' })
    expect(mocks.createUser).not.toHaveBeenCalled()
  })

  it('deletes the new user and returns 500 if the account cannot be linked', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.linkAccount.mockRejectedValue(new Error('db down'))

    const res = await request(app).post('/api/users').send(valid)

    expect(res.status).toBe(500)
    expect(res.body).toEqual({ error: 'Internal server error' })
    expect(mocks.deleteUser).toHaveBeenCalledWith({ where: { id: 'new-user-id' } })
    consoleError.mockRestore()
  })

  it('returns 401 when signed out', async () => {
    signInAs(null)

    const res = await request(app).post('/api/users').send(valid)

    expect(res.status).toBe(401)
    expect(res.body).toEqual({ error: 'Unauthorized' })
    expect(mocks.createUser).not.toHaveBeenCalled()
  })

  it('returns 403 for agents', async () => {
    signInAs('agent')

    const res = await request(app).post('/api/users').send(valid)

    expect(res.status).toBe(403)
    expect(res.body).toEqual({ error: 'Forbidden' })
    expect(mocks.createUser).not.toHaveBeenCalled()
  })
})

describe('GET /api/users', () => {
  it('lists users with only safe fields and maps unknown roles to agent', async () => {
    mocks.findMany.mockResolvedValue([
      { id: '1', name: 'Admin', email: 'admin@example.com', role: 'admin', createdAt },
      { id: '2', name: 'Odd', email: 'odd@example.com', role: 'something-else', createdAt },
    ])

    const res = await request(app).get('/api/users')

    expect(res.status).toBe(200)
    expect(res.body.users).toEqual([
      { id: '1', name: 'Admin', email: 'admin@example.com', role: 'admin', createdAt: createdAt.toISOString() },
      { id: '2', name: 'Odd', email: 'odd@example.com', role: 'agent', createdAt: createdAt.toISOString() },
    ])
    expect(mocks.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: { id: true, name: true, email: true, role: true, createdAt: true },
      }),
    )
  })

  it('returns 403 for agents', async () => {
    signInAs('agent')
    const res = await request(app).get('/api/users')
    expect(res.status).toBe(403)
    expect(mocks.findMany).not.toHaveBeenCalled()
  })
})
