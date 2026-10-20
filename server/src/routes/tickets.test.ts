import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { app } from '../app.js'

// Better Auth and Prisma are mocked, so these tests need no database or env.
const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  findMany: vi.fn(),
  count: vi.fn(),
  findUnique: vi.fn(),
  updateMany: vi.fn(),
  update: vi.fn(),
  findManyUsers: vi.fn(),
  findFirstUser: vi.fn(),
  isAiConfigured: vi.fn(),
  polishReply: vi.fn(),
  summarizeTicket: vi.fn(),
  describeAiError: vi.fn(),
}))

vi.mock('../auth.js', () => ({ auth: { handler: vi.fn(), api: { getSession: mocks.getSession } } }))

vi.mock('../ai.js', () => ({
  isAiConfigured: mocks.isAiConfigured,
  polishReply: mocks.polishReply,
  summarizeTicket: mocks.summarizeTicket,
  describeAiError: mocks.describeAiError,
}))

vi.mock('../db.js', () => ({
  prisma: {
    ticket: {
      findMany: mocks.findMany,
      count: mocks.count,
      findUnique: mocks.findUnique,
      updateMany: mocks.updateMany,
      update: mocks.update,
    },
    user: { findMany: mocks.findManyUsers, findFirst: mocks.findFirstUser },
    $transaction: (ops: Promise<unknown>[]) => Promise.all(ops),
  },
}))

const createdAt = new Date('2026-10-01T12:00:00.000Z')
const updatedAt = new Date('2026-10-02T08:30:00.000Z')

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
  signInAs('agent')
  mocks.findMany.mockResolvedValue([
    {
      id: 't1',
      subject: "Can't log in",
      requesterEmail: 'stu@example.com',
      requesterName: 'Stu',
      status: 'open',
      category: 'technical_question',
      createdAt,
      updatedAt,
      assignee: { id: 'agent-id', name: 'Sam' },
      _count: { messages: 3 },
    },
  ])
  mocks.count.mockResolvedValue(41)
})

describe('GET /api/tickets', () => {
  it('lists tickets for agents with paging info', async () => {
    const res = await request(app).get('/api/tickets')

    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      tickets: [
        {
          id: 't1',
          subject: "Can't log in",
          requesterEmail: 'stu@example.com',
          requesterName: 'Stu',
          status: 'open',
          category: 'technical_question',
          assignee: { id: 'agent-id', name: 'Sam' },
          messageCount: 3,
          createdAt: createdAt.toISOString(),
          updatedAt: updatedAt.toISOString(),
        },
      ],
      total: 41,
      page: 1,
      pageSize: 20,
    })
  })

  it('defaults to the newest 20 tickets', async () => {
    await request(app).get('/api/tickets')

    expect(mocks.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: undefined, category: undefined },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: 0,
        take: 20,
      }),
    )
    expect(mocks.count).toHaveBeenCalledWith({ where: { status: undefined, category: undefined } })
  })

  it('filters, searches, sorts and paginates', async () => {
    await request(app).get('/api/tickets').query({
      status: 'resolved',
      category: 'refund_request',
      q: 'refund',
      sort: 'updatedAt',
      order: 'asc',
      page: 3,
      pageSize: 10,
    })

    const where = {
      status: 'resolved',
      category: 'refund_request',
      OR: [
        { subject: { contains: 'refund', mode: 'insensitive' } },
        { requesterEmail: { contains: 'refund', mode: 'insensitive' } },
        { requesterName: { contains: 'refund', mode: 'insensitive' } },
      ],
    }
    expect(mocks.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where,
        orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
        skip: 20,
        take: 10,
      }),
    )
    expect(mocks.count).toHaveBeenCalledWith({ where })
  })

  it.each([
    ['subject', [{ subject: 'asc' }, { createdAt: 'desc' }, { id: 'desc' }]],
    ['status', [{ status: 'asc' }, { createdAt: 'desc' }, { id: 'desc' }]],
    ['category', [{ category: 'asc' }, { createdAt: 'desc' }, { id: 'desc' }]],
    [
      'requester',
      [{ requesterName: { sort: 'asc', nulls: 'last' } }, { requesterEmail: 'asc' }, { createdAt: 'desc' }, { id: 'desc' }],
    ],
    ['assignee', [{ assignee: { name: 'asc' } }, { createdAt: 'desc' }, { id: 'desc' }]],
  ])('sorts by %s', async (sort, orderBy) => {
    await request(app).get('/api/tickets').query({ sort, order: 'asc' })
    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({ orderBy }))
  })

  it('ignores invalid query values', async () => {
    const res = await request(app)
      .get('/api/tickets')
      .query({ status: 'nope', sort: 'password', page: '-1', pageSize: '9999' })

    expect(res.status).toBe(200)
    expect(mocks.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: undefined, category: undefined },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: 0,
        take: 20,
      }),
    )
  })

  it('returns 401 when signed out', async () => {
    signInAs(null)
    const res = await request(app).get('/api/tickets')
    expect(res.status).toBe(401)
    expect(mocks.findMany).not.toHaveBeenCalled()
  })
})

const detail = {
  id: 't1',
  subject: "Can't log in",
  requesterEmail: 'stu@example.com',
  requesterName: 'Stu',
  status: 'open',
  category: 'technical_question',
  summary: null,
  createdAt,
  updatedAt,
  assignee: null,
  messages: [
    {
      id: 'm1',
      direction: 'inbound',
      fromEmail: 'stu@example.com',
      fromName: 'Stu',
      body: 'Help',
      createdAt,
    },
  ],
}

describe('GET /api/tickets/:id', () => {
  it('returns the ticket with its messages, oldest first', async () => {
    mocks.findUnique.mockResolvedValue(detail)

    const res = await request(app).get('/api/tickets/t1')

    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      ticket: {
        ...detail,
        createdAt: createdAt.toISOString(),
        updatedAt: updatedAt.toISOString(),
        messages: [{ ...detail.messages[0], createdAt: createdAt.toISOString() }],
      },
    })
    expect(mocks.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 't1' },
        select: expect.objectContaining({
          messages: expect.objectContaining({ orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }),
        }),
      }),
    )
  })

  it('returns 404 for an unknown ticket', async () => {
    mocks.findUnique.mockResolvedValue(null)
    const res = await request(app).get('/api/tickets/missing')
    expect(res.status).toBe(404)
    expect(res.body).toEqual({ error: 'Ticket not found' })
  })

  it('returns 401 when signed out', async () => {
    signInAs(null)
    expect((await request(app).get('/api/tickets/t1')).status).toBe(401)
  })
})

describe('PATCH /api/tickets/:id', () => {
  beforeEach(() => {
    mocks.updateMany.mockResolvedValue({ count: 1 })
    mocks.findUnique.mockResolvedValue(detail)
    mocks.findFirstUser.mockResolvedValue({ id: 'agent-2' })
  })

  it('updates the status and returns the ticket', async () => {
    const res = await request(app).patch('/api/tickets/t1').send({ status: 'resolved' })

    expect(res.status).toBe(200)
    expect(res.body.ticket.id).toBe('t1')
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { id: 't1' },
      data: { status: 'resolved', category: undefined, assigneeId: undefined },
    })
  })

  it('updates the category', async () => {
    await request(app).patch('/api/tickets/t1').send({ category: 'refund_request' })
    expect(mocks.updateMany.mock.calls[0][0].data).toMatchObject({ category: 'refund_request' })
  })

  it('assigns to an existing user that is not deleted', async () => {
    const res = await request(app).patch('/api/tickets/t1').send({ assigneeId: 'agent-2' })

    expect(res.status).toBe(200)
    expect(mocks.findFirstUser).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'agent-2', deletedAt: null } }),
    )
    expect(mocks.updateMany.mock.calls[0][0].data).toMatchObject({ assigneeId: 'agent-2' })
  })

  it('unassigns with null', async () => {
    await request(app).patch('/api/tickets/t1').send({ assigneeId: null })

    expect(mocks.findFirstUser).not.toHaveBeenCalled()
    expect(mocks.updateMany.mock.calls[0][0].data).toMatchObject({ assigneeId: null })
  })

  it('returns 400 for an unknown or deleted assignee', async () => {
    mocks.findFirstUser.mockResolvedValue(null)

    const res = await request(app).patch('/api/tickets/t1').send({ assigneeId: 'gone' })

    expect(res.status).toBe(400)
    expect(res.body).toEqual({ error: 'Invalid input', fields: { assigneeId: ['Unknown user'] } })
    expect(mocks.updateMany).not.toHaveBeenCalled()
  })

  it('returns 400 for invalid or empty input', async () => {
    expect((await request(app).patch('/api/tickets/t1').send({ status: 'pending' })).status).toBe(400)
    expect((await request(app).patch('/api/tickets/t1').send({})).status).toBe(400)
    expect(mocks.updateMany).not.toHaveBeenCalled()
  })

  it('returns 404 for an unknown ticket', async () => {
    mocks.updateMany.mockResolvedValue({ count: 0 })
    const res = await request(app).patch('/api/tickets/missing').send({ status: 'closed' })
    expect(res.status).toBe(404)
  })

  it('returns 401 when signed out', async () => {
    signInAs(null)
    expect((await request(app).patch('/api/tickets/t1').send({ status: 'closed' })).status).toBe(401)
    expect(mocks.updateMany).not.toHaveBeenCalled()
  })
})

describe('POST /api/tickets/:id/replies', () => {
  beforeEach(() => {
    mocks.findUnique.mockResolvedValue(detail)
    mocks.update.mockResolvedValue({})
  })

  it("adds the user's reply as an outbound message and returns the ticket", async () => {
    const res = await request(app).post('/api/tickets/t1/replies').send({ body: '  Try resetting it.  ' })

    expect(res.status).toBe(201)
    expect(res.body.ticket.id).toBe('t1')
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: 't1' },
      data: {
        updatedAt: expect.any(Date),
        messages: {
          create: { direction: 'outbound', fromEmail: 'agent@example.com', fromName: 'agent', body: 'Try resetting it.' },
        },
      },
    })
  })

  it('also resolves the ticket with resolve: true', async () => {
    const res = await request(app).post('/api/tickets/t1/replies').send({ body: 'Fixed it.', resolve: true })

    expect(res.status).toBe(201)
    expect(mocks.update.mock.calls[0][0].data).toMatchObject({
      status: 'resolved',
      messages: { create: expect.objectContaining({ body: 'Fixed it.' }) },
    })
  })

  it('returns 400 for an empty or missing body', async () => {
    const res = await request(app).post('/api/tickets/t1/replies').send({ body: '   ' })
    expect(res.status).toBe(400)
    expect(res.body).toEqual({ error: 'Invalid input', fields: { body: ['Write a reply'] } })
    expect((await request(app).post('/api/tickets/t1/replies').send({})).status).toBe(400)
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it('returns 404 for an unknown ticket', async () => {
    mocks.findUnique.mockResolvedValue(null)
    const res = await request(app).post('/api/tickets/missing/replies').send({ body: 'Hi' })
    expect(res.status).toBe(404)
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it('returns 409 for a closed ticket', async () => {
    mocks.findUnique.mockResolvedValue({ ...detail, status: 'closed' })
    const res = await request(app).post('/api/tickets/t1/replies').send({ body: 'Hi' })
    expect(res.status).toBe(409)
    expect(res.body).toEqual({ error: 'Ticket is closed; reopen it to reply' })
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it('returns 401 when signed out', async () => {
    signInAs(null)
    expect((await request(app).post('/api/tickets/t1/replies').send({ body: 'Hi' })).status).toBe(401)
    expect(mocks.update).not.toHaveBeenCalled()
  })
})

describe('POST /api/tickets/:id/replies/polish', () => {
  beforeEach(() => {
    mocks.isAiConfigured.mockReturnValue(true)
    mocks.findUnique.mockResolvedValue({
      subject: "Can't log in",
      assignee: { name: 'Sam' },
      messages: [{ body: 'Still broken' }],
    })
    mocks.polishReply.mockResolvedValue('Please try resetting your password.')
  })

  it('returns the polished draft, using the ticket for context', async () => {
    const res = await request(app).post('/api/tickets/t1/replies/polish').send({ body: '  try reset pw  ' })

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ body: 'Please try resetting your password.' })
    expect(mocks.polishReply).toHaveBeenCalledWith({
      draft: 'try reset pw',
      subject: "Can't log in",
      lastInbound: 'Still broken',
      agentName: 'Sam',
    })
    expect(mocks.findUnique.mock.calls[0][0].where).toEqual({ id: 't1' })
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it("signs with the polishing user's name on an unassigned ticket without inbound messages", async () => {
    mocks.findUnique.mockResolvedValue({ subject: 'Hi', assignee: null, messages: [] })
    await request(app).post('/api/tickets/t1/replies/polish').send({ body: 'hello' })
    expect(mocks.polishReply).toHaveBeenCalledWith({ draft: 'hello', subject: 'Hi', lastInbound: null, agentName: 'agent' })
  })

  it('lets admins polish too', async () => {
    signInAs('admin')
    mocks.findUnique.mockResolvedValue({ subject: 'Hi', assignee: null, messages: [] })

    const res = await request(app).post('/api/tickets/t1/replies/polish').send({ body: 'hello' })

    expect(res.status).toBe(200)
    expect(mocks.polishReply).toHaveBeenCalledWith(expect.objectContaining({ agentName: 'admin' }))
  })

  it('asks only for the latest inbound message', async () => {
    await request(app).post('/api/tickets/t1/replies/polish').send({ body: 'hello' })

    expect(mocks.findUnique.mock.calls[0][0].select.messages).toEqual({
      where: { direction: 'inbound' },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 1,
      select: { body: true },
    })
  })

  it('returns 400 for an empty, missing or too long body', async () => {
    const res = await request(app).post('/api/tickets/t1/replies/polish').send({ body: '   ' })
    expect(res.status).toBe(400)
    expect(res.body).toEqual({ error: 'Invalid input', fields: { body: ['Write a reply'] } })
    expect((await request(app).post('/api/tickets/t1/replies/polish').send({})).status).toBe(400)
    const long = await request(app).post('/api/tickets/t1/replies/polish').send({ body: 'a'.repeat(50_001) })
    expect(long.status).toBe(400)
    expect(mocks.polishReply).not.toHaveBeenCalled()
    expect(mocks.findUnique).not.toHaveBeenCalled()
  })

  it('returns 404 for an unknown ticket', async () => {
    mocks.findUnique.mockResolvedValue(null)
    expect((await request(app).post('/api/tickets/missing/replies/polish').send({ body: 'Hi' })).status).toBe(404)
    expect(mocks.polishReply).not.toHaveBeenCalled()
  })

  it('returns 503 when AI is not configured', async () => {
    mocks.isAiConfigured.mockReturnValue(false)
    const res = await request(app).post('/api/tickets/t1/replies/polish').send({ body: 'Hi' })
    expect(res.status).toBe(503)
    expect(res.body).toEqual({ error: 'AI polishing is not configured' })
    expect(mocks.polishReply).not.toHaveBeenCalled()
  })

  it('returns 502 with an explanation when the AI call fails', async () => {
    const error = new Error('no credits')
    mocks.polishReply.mockRejectedValue(error)
    mocks.describeAiError.mockReturnValue('The AI provider account is out of credits. Ask an admin to add credits.')
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    const res = await request(app).post('/api/tickets/t1/replies/polish').send({ body: 'Hi' })

    expect(res.status).toBe(502)
    expect(res.body).toEqual({ error: 'The AI provider account is out of credits. Ask an admin to add credits.' })
    expect(mocks.describeAiError).toHaveBeenCalledWith(error)
    expect(consoleError).toHaveBeenCalled()
    consoleError.mockRestore()
  })

  it('returns 401 when signed out', async () => {
    signInAs(null)
    expect((await request(app).post('/api/tickets/t1/replies/polish').send({ body: 'Hi' })).status).toBe(401)
    expect(mocks.polishReply).not.toHaveBeenCalled()
  })
})

describe('POST /api/tickets/:id/summary', () => {
  const thread = {
    subject: "Can't log in",
    updatedAt,
    messages: [
      { direction: 'inbound', fromName: 'Stu', fromEmail: 'stu@example.com', body: 'Help', createdAt },
      { direction: 'outbound', fromName: 'Sam', fromEmail: 'sam@example.com', body: 'Reset it', createdAt: updatedAt },
    ],
  }

  beforeEach(() => {
    mocks.isAiConfigured.mockReturnValue(true)
    // First the thread for the AI, then the ticket for the response.
    mocks.findUnique.mockResolvedValueOnce(thread).mockResolvedValue({ ...detail, summary: 'Stu cannot log in.' })
    mocks.summarizeTicket.mockResolvedValue('Stu cannot log in.')
    mocks.updateMany.mockResolvedValue({ count: 1 })
  })

  it('summarizes the whole thread, saves it without bumping updatedAt and returns the ticket', async () => {
    const res = await request(app).post('/api/tickets/t1/summary')

    expect(res.status).toBe(200)
    expect(res.body.ticket.summary).toBe('Stu cannot log in.')
    expect(mocks.findUnique.mock.calls[0][0]).toMatchObject({
      where: { id: 't1' },
      select: { messages: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] } },
    })
    expect(mocks.summarizeTicket).toHaveBeenCalledWith({ subject: "Can't log in", messages: thread.messages })
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { id: 't1' },
      data: { summary: 'Stu cannot log in.', updatedAt },
    })
  })

  it('lets admins summarize too', async () => {
    signInAs('admin')
    expect((await request(app).post('/api/tickets/t1/summary')).status).toBe(200)
  })

  it('returns 404 for an unknown ticket', async () => {
    mocks.findUnique.mockReset().mockResolvedValue(null)
    const res = await request(app).post('/api/tickets/missing/summary')
    expect(res.status).toBe(404)
    expect(mocks.summarizeTicket).not.toHaveBeenCalled()
  })

  it('returns 503 when AI is not configured', async () => {
    mocks.isAiConfigured.mockReturnValue(false)
    const res = await request(app).post('/api/tickets/t1/summary')
    expect(res.status).toBe(503)
    expect(res.body).toEqual({ error: 'AI summaries are not configured' })
    expect(mocks.summarizeTicket).not.toHaveBeenCalled()
  })

  it('returns 502 with an explanation and saves nothing when the AI call fails', async () => {
    const error = new Error('no credits')
    mocks.summarizeTicket.mockRejectedValue(error)
    mocks.describeAiError.mockReturnValue('The AI provider account is out of credits. Ask an admin to add credits.')
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    const res = await request(app).post('/api/tickets/t1/summary')

    expect(res.status).toBe(502)
    expect(res.body).toEqual({ error: 'The AI provider account is out of credits. Ask an admin to add credits.' })
    expect(mocks.describeAiError).toHaveBeenCalledWith(error)
    expect(mocks.updateMany).not.toHaveBeenCalled()
    consoleError.mockRestore()
  })

  it('returns 401 when signed out', async () => {
    signInAs(null)
    expect((await request(app).post('/api/tickets/t1/summary')).status).toBe(401)
    expect(mocks.summarizeTicket).not.toHaveBeenCalled()
  })
})

describe('GET /api/tickets/assignees', () => {
  it('lists users who are not deleted, by name', async () => {
    mocks.findManyUsers.mockResolvedValue([{ id: 'u1', name: 'Ann', email: 'ann@example.com' }])

    const res = await request(app).get('/api/tickets/assignees')

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ users: [{ id: 'u1', name: 'Ann', email: 'ann@example.com' }] })
    expect(mocks.findManyUsers).toHaveBeenCalledWith({
      where: { deletedAt: null },
      select: { id: true, name: true, email: true },
      orderBy: { name: 'asc' },
    })
    expect(mocks.findUnique).not.toHaveBeenCalled()
  })
})
