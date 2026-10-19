import { expect, test, type APIRequestContext } from '@playwright/test'
import { adminStorageState, inboundEmailSecret, testAdmin } from './test-env'

// Reuses the admin session saved by the setup project: no sign-ins here.
test.use({ storageState: adminStorageState })

// Tickets come in through the inbound email endpoint, as in production.
async function receiveEmail(request: APIRequestContext, data: object) {
  const res = await request.post('/api/inbound/email', {
    data,
    headers: { Authorization: `Bearer ${inboundEmailSecret()}` },
  })
  expect(res.ok()).toBe(true)
  return (await res.json()) as { ticketId: string }
}

test.describe('tickets page', () => {
  test('opens from the header link', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('banner').getByRole('link', { name: 'Tickets' }).click()

    await expect(page).toHaveURL(/\/tickets$/)
    await expect(page.getByRole('heading', { name: 'Tickets' })).toBeVisible()
    for (const name of ['Subject', 'Requester', 'Status', 'Category', 'Assignee', 'Created', 'Updated']) {
      await expect(page.getByRole('columnheader', { name })).toBeVisible()
    }
  })

  test('lists received emails and searches, filters and sorts them', async ({ page, request }) => {
    // A unique word to search for, so tickets from other tests don't interfere.
    const tag = `zq${Date.now()}`
    await receiveEmail(request, {
      from: { email: `first-${tag}@example.com`, name: 'First Student' },
      subject: `Older ${tag}`,
      text: 'Hello',
      messageId: `<older-${tag}@x>`,
    })
    await receiveEmail(request, {
      from: { email: `second-${tag}@example.com` },
      subject: `Newer ${tag}`,
      text: 'Hello',
      messageId: `<newer-${tag}@x>`,
    })
    // A reply makes the older ticket the most recently updated one.
    await receiveEmail(request, {
      from: { email: `first-${tag}@example.com` },
      subject: `Re: Older ${tag}`,
      text: 'Any news?',
      messageId: `<reply-${tag}@x>`,
      inReplyTo: `<older-${tag}@x>`,
    })

    await page.goto('/tickets')
    await page.getByRole('searchbox', { name: 'Search tickets' }).fill(tag)
    await expect(page).toHaveURL(new RegExp(`q=${tag}`))

    const rows = page.getByRole('row').filter({ hasText: tag })
    await expect(rows).toHaveCount(2)
    // Newest first by default.
    await expect(rows.nth(0)).toContainText(`Newer ${tag}`)
    await expect(rows.nth(1)).toContainText(`Older ${tag}`)
    await expect(rows.nth(1)).toContainText('First Student')
    await expect(rows.nth(1)).toContainText('2 messages')
    await expect(rows.nth(1)).toContainText('Open')
    await expect(rows.nth(1)).toContainText('General question')
    await expect(rows.nth(1)).toContainText('Unassigned')
    await expect(page.getByText('1–2 of 2 tickets')).toBeVisible()

    // Most recently updated first.
    await page.getByRole('button', { name: 'Updated' }).click()
    await expect(page).toHaveURL(/sort=updatedAt/)
    await expect(rows.nth(0)).toContainText(`Older ${tag}`)

    // Search also matches the requester's email.
    await page.getByRole('searchbox', { name: 'Search tickets' }).fill(`second-${tag}`)
    await expect(rows).toHaveCount(1)
    await expect(rows.first()).toContainText(`Newer ${tag}`)

    // No closed tickets with this tag.
    await page.getByRole('combobox', { name: 'Status' }).click()
    await page.getByRole('option', { name: 'Closed' }).click()
    await expect(page).toHaveURL(/status=closed/)
    await expect(page.getByText('No tickets match these filters.')).toBeVisible()

    // Clearing filters keeps the chosen sort.
    await page.getByRole('button', { name: 'Clear filters' }).click()
    await expect(page).toHaveURL(/\/tickets\?sort=updatedAt$/)
    await expect(page.getByRole('searchbox', { name: 'Search tickets' })).toHaveValue('')
  })
})

test.describe('ticket detail page', () => {
  test('shows the thread and updates status, category and assignee', async ({ page, request }) => {
    const tag = `zd${Date.now()}`
    await receiveEmail(request, {
      from: { email: `stu-${tag}@example.com`, name: 'Stu Dent' },
      subject: `Refund ${tag}`,
      text: 'I was charged twice.\nPlease help.',
      messageId: `<first-${tag}@x>`,
    })
    await receiveEmail(request, {
      from: { email: `stu-${tag}@example.com` },
      subject: `Re: Refund ${tag}`,
      text: 'Any update?',
      messageId: `<second-${tag}@x>`,
      inReplyTo: `<first-${tag}@x>`,
    })

    // Open it from a filtered list.
    await page.goto(`/tickets?q=${tag}`)
    await page.getByRole('link', { name: `Refund ${tag}` }).click()
    await expect(page.getByRole('heading', { name: `Refund ${tag}` })).toBeVisible()
    await expect(page.getByText(`From Stu Dent <stu-${tag}@example.com>`)).toBeVisible()

    const messages = page.getByRole('region', { name: 'Messages' }).getByRole('article')
    await expect(messages).toHaveCount(2)
    await expect(messages.nth(0)).toContainText('I was charged twice.')
    await expect(messages.nth(1)).toContainText('Any update?')

    const status = page.getByRole('combobox', { name: 'Status' })
    await status.click()
    await page.getByRole('option', { name: 'Resolved' }).click()
    await expect(status).toHaveText('Resolved')

    const category = page.getByRole('combobox', { name: 'Category' })
    await category.click()
    await page.getByRole('option', { name: 'Refund request' }).click()
    await expect(category).toHaveText('Refund request')

    await page.getByRole('button', { name: 'Assign to me' }).click()
    await expect(page.getByRole('combobox', { name: 'Assignee' })).toHaveText(testAdmin.name)
    await expect(page.getByRole('button', { name: 'Assign to me' })).toBeHidden()

    // Saved: still there after a reload.
    await page.reload()
    await expect(status).toHaveText('Resolved')
    await expect(category).toHaveText('Refund request')

    // Back goes to the filtered list, which shows the changes.
    await page.getByRole('link', { name: 'Back to tickets' }).click()
    await expect(page).toHaveURL(new RegExp(`/tickets\\?q=${tag}$`))
    const row = page.getByRole('row').filter({ hasText: `Refund ${tag}` })
    await expect(row).toContainText('Resolved')
    await expect(row).toContainText('Refund request')
    await expect(row).toContainText(testAdmin.name)
  })

  test('replies to a ticket', async ({ page, request }) => {
    const tag = `zr${Date.now()}`
    await receiveEmail(request, {
      from: { email: `stu-${tag}@example.com`, name: 'Stu Dent' },
      subject: `Login ${tag}`,
      text: 'I cannot log in.',
      messageId: `<first-${tag}@x>`,
    })

    await page.goto(`/tickets?q=${tag}`)
    await page.getByRole('link', { name: `Login ${tag}` }).click()

    const reply = page.getByRole('textbox', { name: 'Reply' })
    await expect(reply).toHaveAttribute('placeholder', 'Reply to Stu Dent')
    await reply.fill('Try resetting your password.\nIt should work then.')
    await page.getByRole('button', { name: 'Send reply' }).click()

    const messages = page.getByRole('region', { name: 'Messages' }).getByRole('article')
    await expect(messages).toHaveCount(2)
    const sent = messages.nth(1)
    await expect(sent).toHaveAccessibleName(`Message from ${testAdmin.name}`)
    await expect(sent).toContainText(testAdmin.email)
    await expect(sent).toContainText('Reply')
    await expect(sent).toContainText('Try resetting your password.\nIt should work then.')
    await expect(reply).toHaveValue('')
    // A plain reply leaves the status alone.
    await expect(page.getByRole('combobox', { name: 'Status' })).toHaveText('Open')

    // Saved: still there after a reload.
    await page.reload()
    await expect(messages).toHaveCount(2)
    await expect(messages.nth(1)).toContainText('Try resetting your password.')

    await page.getByRole('link', { name: 'Back to tickets' }).click()
    await expect(page.getByRole('row').filter({ hasText: `Login ${tag}` })).toContainText('2 messages')
  })

  test('sends a reply and resolves the ticket in one step', async ({ page, request }) => {
    const tag = `zs${Date.now()}`
    const { ticketId } = await receiveEmail(request, {
      from: { email: `stu-${tag}@example.com` },
      subject: `Refund ${tag}`,
      text: 'Please refund me.',
      messageId: `<first-${tag}@x>`,
    })

    await page.goto(`/tickets/${ticketId}`)
    await page.getByRole('textbox', { name: 'Reply' }).fill('Refunded, sorry for the trouble.')
    await page.getByRole('button', { name: 'Send & resolve' }).click()

    await expect(page.getByRole('combobox', { name: 'Status' })).toHaveText('Resolved')
    await expect(page.getByRole('region', { name: 'Messages' }).getByRole('article')).toHaveCount(2)
    // Already resolved, so only a plain reply is offered.
    await expect(page.getByRole('button', { name: 'Send & resolve' })).toBeHidden()
    await expect(page.getByRole('button', { name: 'Send reply' })).toBeVisible()

    await page.reload()
    await expect(page.getByRole('combobox', { name: 'Status' })).toHaveText('Resolved')
  })

  test('does not send an empty reply', async ({ page, request }) => {
    const tag = `ze${Date.now()}`
    const { ticketId } = await receiveEmail(request, {
      from: { email: `stu-${tag}@example.com` },
      subject: `Empty ${tag}`,
      text: 'Hello',
      messageId: `<first-${tag}@x>`,
    })

    await page.goto(`/tickets/${ticketId}`)
    const reply = page.getByRole('textbox', { name: 'Reply' })
    await reply.fill('   ')
    await page.getByRole('button', { name: 'Send reply' }).click()

    await expect(page.getByRole('alert')).toHaveText('Write a reply')
    await expect(reply).toHaveAttribute('aria-invalid', 'true')
    await page.reload()
    await expect(page.getByRole('region', { name: 'Messages' }).getByRole('article')).toHaveCount(1)
  })

  test('only lets agents reply once a closed ticket is reopened', async ({ page, request }) => {
    const tag = `zc${Date.now()}`
    const { ticketId } = await receiveEmail(request, {
      from: { email: `stu-${tag}@example.com` },
      subject: `Closed ${tag}`,
      text: 'Hello',
      messageId: `<first-${tag}@x>`,
    })

    await page.goto(`/tickets/${ticketId}`)
    const status = page.getByRole('combobox', { name: 'Status' })
    await status.click()
    await page.getByRole('option', { name: 'Closed' }).click()
    await expect(status).toHaveText('Closed')

    await expect(page.getByText('This ticket is closed. Reopen it to reply.')).toBeVisible()
    await expect(page.getByRole('textbox', { name: 'Reply' })).toBeHidden()

    // The API refuses too (page.request shares the page's session cookie).
    const res = await page.request.post(`/api/tickets/${ticketId}/replies`, { data: { body: 'Hi' } })
    expect(res.status()).toBe(409)
    expect(await res.json()).toEqual({ error: 'Ticket is closed; reopen it to reply' })

    await status.click()
    await page.getByRole('option', { name: 'Open' }).click()
    await expect(status).toHaveText('Open')
    await expect(page.getByRole('textbox', { name: 'Reply' })).toBeVisible()
  })

  test('says when a ticket does not exist', async ({ page }) => {
    await page.goto('/tickets/does-not-exist')
    await expect(page.getByRole('alert')).toHaveText('Ticket not found.')
  })
})

test.describe('tickets API', () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test('rejects unauthenticated requests', async ({ request }) => {
    for (const res of [
      await request.get('/api/tickets'),
      await request.get('/api/tickets/any-id'),
      await request.get('/api/tickets/assignees'),
      await request.patch('/api/tickets/any-id', { data: { status: 'closed' } }),
      await request.post('/api/tickets/any-id/replies', { data: { body: 'Hi' } }),
    ]) {
      expect(res.status()).toBe(401)
      expect(await res.json()).toEqual({ error: 'Unauthorized' })
    }
  })
})
