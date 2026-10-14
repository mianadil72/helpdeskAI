import { expect, test } from '@playwright/test'
import { inboundEmailSecret } from './test-env'

// Machine-to-machine endpoint: authenticates with the shared secret, so no sign-ins.
test.describe('inbound email', () => {
  const auth = { Authorization: `Bearer ${inboundEmailSecret()}` }

  test('creates a ticket, threads a reply onto it and dedups redeliveries', async ({ request }) => {
    const id = Date.now()
    const first = {
      from: { email: `student-${id}@example.com`, name: 'Stu Dent' },
      subject: "Can't log in",
      text: 'My password stopped working.',
      messageId: `<first-${id}@mail.example.com>`,
    }

    const created = await request.post('/api/inbound/email', { data: first, headers: auth })
    expect(created.status()).toBe(201)
    const { ticketId } = await created.json()
    expect(await created.json()).toMatchObject({ result: 'created', ticketId: expect.any(String) })

    const reply = {
      ...first,
      subject: "Re: Can't log in",
      text: 'Still broken.',
      messageId: `<reply-${id}@mail.example.com>`,
      inReplyTo: first.messageId,
    }
    const appended = await request.post('/api/inbound/email', { data: reply, headers: auth })
    expect(appended.status()).toBe(200)
    expect(await appended.json()).toMatchObject({ result: 'appended', ticketId })

    const again = await request.post('/api/inbound/email', { data: reply, headers: auth })
    expect(await again.json()).toMatchObject({ result: 'duplicate', ticketId })

    // Someone else replying to the thread gets their own ticket.
    const stranger = await request.post('/api/inbound/email', {
      data: { ...reply, from: { email: `other-${id}@example.com` }, messageId: `<other-${id}@x>` },
      headers: auth,
    })
    expect(stranger.status()).toBe(201)
    expect((await stranger.json()).ticketId).not.toBe(ticketId)
  })

  test('ignores auto-replies', async ({ request }) => {
    const res = await request.post('/api/inbound/email', {
      data: {
        from: { email: 'student@example.com' },
        subject: 'Out of office',
        text: 'I am away.',
        messageId: `<ooo-${Date.now()}@x>`,
        headers: { 'Auto-Submitted': 'auto-replied' },
      },
      headers: auth,
    })
    expect(res.status()).toBe(200)
    expect(await res.json()).toEqual({ result: 'ignored' })
  })

  test('rejects a wrong secret', async ({ request }) => {
    const res = await request.post('/api/inbound/email', {
      data: {},
      headers: { Authorization: 'Bearer wrong' },
    })
    expect(res.status()).toBe(401)
  })
})
