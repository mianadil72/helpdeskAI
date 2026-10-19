import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { createReplySchema, createUserSchema, inboundEmailSchema, ticketListQuerySchema, updateTicketSchema, updateUserSchema } from './index.js'

const valid = { name: 'Jane Doe', email: 'jane@example.com', password: 'password123' }

// Field → first error message, for asserting which rule failed.
function errorsFor(input: unknown, schema: typeof createUserSchema | typeof updateUserSchema = createUserSchema) {
  const result = schema.safeParse(input)
  if (result.success) return {}
  const { fieldErrors } = z.flattenError(result.error)
  return Object.fromEntries(Object.entries(fieldErrors).map(([k, v]) => [k, v?.[0]]))
}

describe('createUserSchema', () => {
  it('accepts valid input', () => {
    expect(createUserSchema.parse(valid)).toEqual(valid)
  })

  it('trims the name and trims and lowercases the email', () => {
    const parsed = createUserSchema.parse({ ...valid, name: '  Jane  ', email: '  Jane@Example.COM ' })
    expect(parsed.name).toBe('Jane')
    expect(parsed.email).toBe('jane@example.com')
  })

  it('does not trim the password', () => {
    expect(createUserSchema.parse({ ...valid, password: ' pass word ' }).password).toBe(' pass word ')
  })

  it('requires every field', () => {
    expect(errorsFor({ name: '', email: '', password: '' })).toEqual({
      name: 'Name is required',
      email: 'Email is required',
      password: 'Password must be at least 8 characters',
    })
  })

  it('treats a whitespace-only name as missing', () => {
    expect(errorsFor({ ...valid, name: '   ' })).toEqual({ name: 'Name is required' })
  })

  it('rejects a name over 100 characters', () => {
    expect(errorsFor({ ...valid, name: 'a'.repeat(100) })).toEqual({})
    expect(errorsFor({ ...valid, name: 'a'.repeat(101) })).toEqual({
      name: 'Name must be at most 100 characters',
    })
  })

  it.each(['not-an-email', 'jane@', '@example.com', 'jane example.com'])(
    'rejects the invalid email %j',
    (email) => {
      expect(errorsFor({ ...valid, email })).toEqual({ email: 'Enter a valid email address' })
    },
  )

  it('enforces the 8–128 character password limits', () => {
    expect(errorsFor({ ...valid, password: 'a'.repeat(7) })).toEqual({
      password: 'Password must be at least 8 characters',
    })
    expect(errorsFor({ ...valid, password: 'a'.repeat(8) })).toEqual({})
    expect(errorsFor({ ...valid, password: 'a'.repeat(128) })).toEqual({})
    expect(errorsFor({ ...valid, password: 'a'.repeat(129) })).toEqual({
      password: 'Password must be at most 128 characters',
    })
  })

  it('rejects non-string values', () => {
    expect(Object.keys(errorsFor({ name: 1, email: null, password: {} })).sort()).toEqual([
      'email',
      'name',
      'password',
    ])
  })

  it('strips unknown keys such as role', () => {
    expect(createUserSchema.parse({ ...valid, role: 'admin' })).not.toHaveProperty('role')
  })
})

describe('updateUserSchema', () => {
  const edit = { name: 'Jane Doe', email: 'jane@example.com' }

  it('makes the password optional', () => {
    expect(updateUserSchema.parse(edit)).toEqual(edit)
  })

  it('treats a blank password as "keep the current one"', () => {
    expect(updateUserSchema.parse({ ...edit, password: '' })).toEqual({ ...edit, password: undefined })
  })

  it('keeps a new password', () => {
    expect(updateUserSchema.parse({ ...edit, password: 'new-password-1' }).password).toBe('new-password-1')
  })

  it('applies the same password limits as creating a user', () => {
    expect(errorsFor({ ...edit, password: 'a'.repeat(7) }, updateUserSchema)).toEqual({
      password: 'Password must be at least 8 characters',
    })
    expect(errorsFor({ ...edit, password: 'a'.repeat(8) }, updateUserSchema)).toEqual({})
    expect(errorsFor({ ...edit, password: 'a'.repeat(129) }, updateUserSchema)).toEqual({
      password: 'Password must be at most 128 characters',
    })
  })

  it('applies the same name and email rules as creating a user', () => {
    expect(errorsFor({ name: ' ', email: 'nope' }, updateUserSchema)).toEqual({
      name: 'Name is required',
      email: 'Enter a valid email address',
    })
    expect(updateUserSchema.parse({ name: ' Jane ', email: ' Jane@Example.COM ' })).toEqual({
      name: 'Jane',
      email: 'jane@example.com',
    })
  })

  it('strips unknown keys such as role', () => {
    expect(updateUserSchema.parse({ ...edit, role: 'admin' })).not.toHaveProperty('role')
  })
})

describe('inboundEmailSchema', () => {
  const email = {
    from: { email: ' Student@Example.com ', name: ' Stu ' },
    subject: ' Help ',
    text: 'I cannot log in',
    messageId: ' <abc@mail.example.com> ',
  }

  it('normalises the sender, subject and Message-IDs', () => {
    const parsed = inboundEmailSchema.parse({
      ...email,
      inReplyTo: '<prev@example.com>',
      references: ['<root@example.com>', 'prev@example.com'],
      headers: { 'Auto-Submitted': 'no' },
    })
    expect(parsed).toEqual({
      from: { email: 'student@example.com', name: 'Stu' },
      subject: 'Help',
      text: 'I cannot log in',
      messageId: 'abc@mail.example.com',
      inReplyTo: 'prev@example.com',
      references: ['root@example.com', 'prev@example.com'],
      headers: { 'auto-submitted': 'no' },
    })
  })

  it('fills in a blank subject and drops a blank name', () => {
    const parsed = inboundEmailSchema.parse({ ...email, subject: '  ', from: { email: 'a@b.co', name: '' } })
    expect(parsed.subject).toBe('(no subject)')
    expect(parsed.from.name).toBeUndefined()
  })

  it('accepts an HTML-only email', () => {
    expect(inboundEmailSchema.safeParse({ ...email, text: undefined, html: '<p>Hi</p>' }).success).toBe(true)
  })

  it('rejects an email without a body, sender or Message-ID', () => {
    const result = inboundEmailSchema.safeParse({ from: { email: 'nope' }, text: ' ', messageId: '<>' })
    expect(result.success).toBe(false)
    const paths = result.error!.issues.map((issue) => issue.path.join('.'))
    expect(paths).toEqual(expect.arrayContaining(['from.email', 'messageId']))

    const noBody = inboundEmailSchema.safeParse({ ...email, text: ' ' })
    expect(noBody.error?.issues[0]).toMatchObject({ path: ['text'], message: 'The email has no body' })
  })
})

describe('ticketListQuerySchema', () => {
  it('defaults to the newest 20 tickets', () => {
    expect(ticketListQuerySchema.parse({})).toEqual({
      sort: 'createdAt',
      order: 'desc',
      page: 1,
      pageSize: 20,
    })
  })

  it('parses filters, search, sorting and paging from query strings', () => {
    expect(
      ticketListQuerySchema.parse({
        status: 'resolved',
        category: 'refund_request',
        q: ' login ',
        sort: 'updatedAt',
        order: 'asc',
        page: '3',
        pageSize: '50',
      }),
    ).toEqual({
      status: 'resolved',
      category: 'refund_request',
      q: 'login',
      sort: 'updatedAt',
      order: 'asc',
      page: 3,
      pageSize: 50,
    })
  })

  it('falls back to defaults for invalid values', () => {
    expect(
      ticketListQuerySchema.parse({
        status: 'pending',
        category: 'x',
        q: '  ',
        sort: 'password',
        order: 'up',
        page: '0',
        pageSize: '1000',
      }),
    ).toEqual({ sort: 'createdAt', order: 'desc', page: 1, pageSize: 20 })
  })
})

describe('updateTicketSchema', () => {
  it('accepts any one field, and null to unassign', () => {
    expect(updateTicketSchema.parse({ status: 'resolved' })).toEqual({ status: 'resolved' })
    expect(updateTicketSchema.parse({ category: 'refund_request' })).toEqual({ category: 'refund_request' })
    expect(updateTicketSchema.parse({ assigneeId: null })).toEqual({ assigneeId: null })
  })

  it('rejects an empty body and unknown values', () => {
    expect(updateTicketSchema.safeParse({}).success).toBe(false)
    expect(updateTicketSchema.safeParse({ status: 'pending' }).success).toBe(false)
    expect(updateTicketSchema.safeParse({ assigneeId: '' }).success).toBe(false)
  })
})

describe('createReplySchema', () => {
  it('trims the body and defaults resolve to false', () => {
    expect(createReplySchema.parse({ body: '  Hi there  ' })).toEqual({ body: 'Hi there', resolve: false })
    expect(createReplySchema.parse({ body: 'Hi', resolve: true })).toEqual({ body: 'Hi', resolve: true })
  })

  it('rejects blank and overlong replies', () => {
    expect(createReplySchema.safeParse({ body: '   ' }).success).toBe(false)
    expect(createReplySchema.safeParse({ body: 'x'.repeat(50_001) }).success).toBe(false)
    expect(createReplySchema.safeParse({}).success).toBe(false)
  })
})