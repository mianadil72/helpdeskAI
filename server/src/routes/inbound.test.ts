import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { app } from '../app.js'

// Prisma is mocked, so these tests need no database or env.
const mocks = vi.hoisted(() => ({
  findUniqueMessage: vi.fn(),
  findFirstMessage: vi.fn(),
  createMessage: vi.fn(),
  createTicket: vi.fn(),
  updateTicket: vi.fn(),
}))

vi.mock('../auth.js', () => ({ auth: { handler: vi.fn(), api: { getSession: vi.fn() } } }))

vi.mock('../db.js', () => ({
  prisma: {
    message: {
      findUnique: mocks.findUniqueMessage,
      findFirst: mocks.findFirstMessage,
      create: mocks.createMessage,
    },
    ticket: { create: mocks.createTicket, update: mocks.updateTicket },
    $transaction: (ops: Promise<unknown>[]) => Promise.all(ops),
  },
}))

const secret = 'test-inbound-secret'
const email = {
  from: { email: 'Student@Example.com', name: 'Stu Dent' },
  subject: "Can't log in",
  text: 'My password stopped working.',
  messageId: '<new-1@mail.example.com>',
}

function post(body: unknown, auth = `Bearer ${secret}`) {
  return request(app).post('/api/inbound/email').set('Authorization', auth).send(body as object)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('INBOUND_EMAIL_SECRET', secret)
  mocks.findUniqueMessage.mockResolvedValue(null)
  mocks.findFirstMessage.mockResolvedValue(null)
  mocks.createTicket.mockResolvedValue({ id: 'ticket-1', messages: [{ id: 'message-1' }] })
  mocks.createMessage.mockResolvedValue({ id: 'message-2' })
  mocks.updateTicket.mockResolvedValue({})
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('POST /api/inbound/email', () => {
  it('creates a ticket with the email as its first message', async () => {
    const res = await post(email)

    expect(res.status).toBe(201)
    expect(res.body).toEqual({ result: 'created', ticketId: 'ticket-1', messageId: 'message-1' })
    expect(mocks.createTicket).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          subject: "Can't log in",
          requesterEmail: 'student@example.com',
          requesterName: 'Stu Dent',
          messages: {
            create: {
              direction: 'inbound',
              fromEmail: 'student@example.com',
              fromName: 'Stu Dent',
              body: 'My password stopped working.',
              emailMessageId: 'new-1@mail.example.com',
            },
          },
        },
      }),
    )
  })

  it('uses the HTML as plain text when there is no text body', async () => {
    await post({ ...email, text: undefined, html: '<p>Hello &amp; thanks</p><p>Stu</p>' })

    expect(mocks.createTicket.mock.calls[0][0].data.messages.create.body).toBe('Hello & thanks\nStu')
  })

  it('accepts emails larger than the default 100 kB JSON limit', async () => {
    const res = await post({ ...email, text: 'x'.repeat(500_000) })
    expect(res.status).toBe(201)
  })

  it('appends a reply to its ticket via In-Reply-To', async () => {
    mocks.findFirstMessage.mockResolvedValue({ ticket: { id: 'ticket-1', status: 'open' } })

    const res = await post({ ...email, messageId: '<reply@x>', inReplyTo: '<new-1@mail.example.com>' })

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ result: 'appended', ticketId: 'ticket-1', messageId: 'message-2' })
    expect(mocks.findFirstMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          emailMessageId: { in: ['new-1@mail.example.com'] },
          ticket: { requesterEmail: 'student@example.com', status: { not: 'closed' } },
        },
      }),
    )
    expect(mocks.createMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ ticketId: 'ticket-1', emailMessageId: 'reply@x' }),
      }),
    )
    expect(mocks.updateTicket).toHaveBeenCalledWith({ where: { id: 'ticket-1' }, data: { status: 'open' } })
    expect(mocks.createTicket).not.toHaveBeenCalled()
  })

  it('reopens a resolved ticket and matches on References too', async () => {
    mocks.findFirstMessage.mockResolvedValue({ ticket: { id: 'ticket-1', status: 'resolved' } })

    const res = await post({ ...email, messageId: '<reply@x>', references: ['<root@x>', '<mid@x>'] })

    expect(res.body.result).toBe('appended')
    expect(mocks.findFirstMessage.mock.calls[0][0].where.emailMessageId).toEqual({ in: ['root@x', 'mid@x'] })
    expect(mocks.updateTicket).toHaveBeenCalledWith({ where: { id: 'ticket-1' }, data: { status: 'open' } })
  })

  it('creates a new ticket when no open ticket from this sender matches the reply', async () => {
    // findFirst filters out closed tickets and other senders' tickets.
    const res = await post({ ...email, inReplyTo: '<someone-elses@x>' })

    expect(res.status).toBe(201)
    expect(res.body.result).toBe('created')
  })

  it('reports a redelivered email as a duplicate without saving it again', async () => {
    mocks.findUniqueMessage.mockResolvedValue({ id: 'message-1', ticketId: 'ticket-1' })

    const res = await post(email)

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ result: 'duplicate', ticketId: 'ticket-1', messageId: 'message-1' })
    expect(mocks.findUniqueMessage).toHaveBeenCalledWith(
      expect.objectContaining({ where: { emailMessageId: 'new-1@mail.example.com' } }),
    )
    expect(mocks.createTicket).not.toHaveBeenCalled()
  })

  it('reports a duplicate when a concurrent delivery wins the insert', async () => {
    mocks.createTicket.mockRejectedValue(Object.assign(new Error('Unique constraint'), { code: 'P2002' }))
    mocks.findUniqueMessage
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'message-1', ticketId: 'ticket-1' })

    const res = await post(email)

    expect(res.status).toBe(200)
    expect(res.body.result).toBe('duplicate')
  })

  it('ignores auto-replies', async () => {
    const res = await post({ ...email, headers: { 'Auto-Submitted': 'auto-replied' } })

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ result: 'ignored' })
    expect(mocks.createTicket).not.toHaveBeenCalled()
  })

  it('returns 400 with field errors for invalid input', async () => {
    const res = await post({ from: { email: 'nope' }, messageId: '' })

    expect(res.status).toBe(400)
    expect(Object.keys(res.body.fields)).toEqual(expect.arrayContaining(['from', 'messageId']))
    expect(mocks.createTicket).not.toHaveBeenCalled()
  })

  it('returns 401 for a missing or wrong secret', async () => {
    expect((await request(app).post('/api/inbound/email').send(email)).status).toBe(401)
    const res = await post(email, 'Bearer wrong')
    expect(res.status).toBe(401)
    expect(res.body).toEqual({ error: 'Unauthorized' })
    expect(mocks.createTicket).not.toHaveBeenCalled()
  })

  it('returns 503 when no secret is configured', async () => {
    vi.stubEnv('INBOUND_EMAIL_SECRET', '')

    const res = await post(email)

    expect(res.status).toBe(503)
    expect(res.body).toEqual({ error: 'Inbound email is not configured' })
  })
})
