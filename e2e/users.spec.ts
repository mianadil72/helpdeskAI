import { expect, test } from '@playwright/test'
import { adminStorageState, baseURL, testAdmin } from './test-env'

// Two sign-ins here (the new agent, then again after deletion); retries stay off so CI retries can't eat
// the sign-in budget.
test.describe.configure({ retries: 0 })

test.describe('users page (admin)', () => {
  test.use({ storageState: adminStorageState })

  test('opens from the header link and lists the admin', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('banner').getByRole('link', { name: 'Users' }).click()

    await expect(page).toHaveURL(/\/users$/)
    await expect(page.getByRole('heading', { name: 'Users' })).toBeVisible()
    for (const name of ['Name', 'Email', 'Role', 'Created']) {
      await expect(page.getByRole('columnheader', { name })).toBeVisible()
    }

    const row = page.getByRole('row').filter({ hasText: testAdmin.email })
    await expect(row.getByRole('cell', { name: testAdmin.name, exact: true })).toBeVisible()
    await expect(row.getByText('admin', { exact: true })).toBeVisible()
  })

  // Covers the whole lifecycle so it can reuse one sign-in from the budget:
  // create in the modal → the agent signs in → delete in the UI → signed out.
  test('creates an agent who can sign in, then deletes them and signs them out', async ({ page, playwright }) => {
    const email = `agent-${Date.now()}@example.com`
    await page.goto('/users')
    await page.getByRole('button', { name: 'New user' }).click()

    const dialog = page.getByRole('dialog', { name: 'Create user' })
    await dialog.getByLabel('Name').fill('New Agent')
    await dialog.getByLabel('Email').fill(email)
    await dialog.getByLabel('Password').fill('password123')
    await dialog.getByRole('button', { name: 'Create user' }).click()

    await expect(dialog).toBeHidden()
    const row = page.getByRole('row').filter({ hasText: email })
    await expect(row.getByRole('cell', { name: 'New Agent', exact: true })).toBeVisible()
    await expect(row.getByText('agent', { exact: true })).toBeVisible()

    // Fresh context so the admin's cookie isn't sent. One sign-in from the budget.
    const agent = await playwright.request.newContext({ baseURL })
    const res = await agent.post('/api/auth/sign-in/email', {
      data: { email, password: 'password123' },
      headers: { Origin: baseURL },
    })
    expect(res.ok()).toBe(true)
    const me = await agent.get('/api/me')
    expect((await me.json()).user).toMatchObject({ email, name: 'New Agent', role: 'agent' })
    // Agents can't use the admin-only users API.
    expect((await agent.get('/api/users')).status()).toBe(403)

    await row.getByRole('button', { name: `Delete ${email}` }).click()
    const confirm = page.getByRole('alertdialog', { name: 'Delete user?' })
    await expect(confirm).toContainText(`New Agent (${email})`)
    await confirm.getByRole('button', { name: 'Delete' }).click()

    await expect(confirm).toBeHidden()
    await expect(page.getByRole('row').filter({ hasText: email })).toHaveCount(0)
    // Deleting the user removed their session too.
    expect((await agent.get('/api/me')).status()).toBe(401)
    // Soft-deleted: the right password no longer works (second sign-in from the budget)…
    const again = await agent.post('/api/auth/sign-in/email', {
      data: { email, password: 'password123' },
      headers: { Origin: baseURL },
    })
    expect(again.status()).toBe(401)
    expect(await again.json()).toMatchObject({ message: 'Invalid email or password' })
    await agent.dispose()
    // …and the row is kept, so the email can't be reused.
    const reuse = await page.request.post('/api/users', {
      data: { name: 'Reuse', email, password: 'password123' },
    })
    expect(reuse.status()).toBe(409)
  })

  test('keeps the user when the delete is cancelled', async ({ page }) => {
    const email = `keep-${Date.now()}@example.com`
    await page.request.post('/api/users', { data: { name: 'Keep Me', email, password: 'password123' } })

    await page.goto('/users')
    await page.getByRole('button', { name: `Delete ${email}` }).click()
    const confirm = page.getByRole('alertdialog', { name: 'Delete user?' })
    await confirm.getByRole('button', { name: 'Cancel' }).click()

    await expect(confirm).toBeHidden()
    await expect(page.getByRole('row').filter({ hasText: email })).toHaveCount(1)
  })

  test("can't delete the signed-in admin", async ({ page }) => {
    await page.goto('/users')
    await expect(page.getByRole('button', { name: `Delete ${testAdmin.email}` })).toBeDisabled()

    const users = (await (await page.request.get('/api/users')).json()) as { users: { id: string; email: string }[] }
    const me = users.users.find((u) => u.email === testAdmin.email)!
    const res = await page.request.delete(`/api/users/${me.id}`)
    expect(res.status()).toBe(403)
    expect(await res.json()).toEqual({ error: "You can't delete your own account" })
  })

  test('validates the form before submitting', async ({ page }) => {
    await page.goto('/users')
    await page.getByRole('button', { name: 'New user' }).click()

    const dialog = page.getByRole('dialog', { name: 'Create user' })
    await dialog.getByRole('button', { name: 'Create user' }).click()
    await expect(dialog.getByText('Name is required')).toBeVisible()
    await expect(dialog.getByText('Email is required')).toBeVisible()
    await expect(dialog.getByText('Password must be at least 8 characters')).toBeVisible()

    await dialog.getByLabel('Email').fill('not-an-email')
    await dialog.getByLabel('Password').fill('short')
    await dialog.getByRole('button', { name: 'Create user' }).click()
    await expect(dialog.getByText('Enter a valid email address')).toBeVisible()
    await expect(dialog.getByText('Password must be at least 8 characters')).toBeVisible()
  })

  test('rejects an email that is already in use', async ({ page }) => {
    await page.goto('/users')
    await page.getByRole('button', { name: 'New user' }).click()

    const dialog = page.getByRole('dialog', { name: 'Create user' })
    await dialog.getByLabel('Name').fill('Duplicate')
    await dialog.getByLabel('Email').fill(testAdmin.email)
    await dialog.getByLabel('Password').fill('password123')
    await dialog.getByRole('button', { name: 'Create user' }).click()

    await expect(dialog.getByText('A user with this email already exists')).toBeVisible()
  })

  test('edits a user from the edit button in their row', async ({ page }) => {
    const email = `edit-${Date.now()}@example.com`
    const newEmail = `edited-${Date.now()}@example.com`
    const created = await page.request.post('/api/users', {
      data: { name: 'Before Edit', email, password: 'password123' },
    })
    expect(created.status()).toBe(201)

    await page.goto('/users')
    await page.getByRole('row').filter({ hasText: email }).getByRole('button', { name: `Edit ${email}` }).click()

    const dialog = page.getByRole('dialog', { name: 'Edit user' })
    await expect(dialog.getByLabel('Name')).toHaveValue('Before Edit')
    await expect(dialog.getByLabel('Email')).toHaveValue(email)
    await expect(dialog.getByLabel('Password')).toHaveValue('')

    await dialog.getByLabel('Name').fill('After Edit')
    await dialog.getByLabel('Email').fill(newEmail)
    await dialog.getByRole('button', { name: 'Save changes' }).click()

    await expect(dialog).toBeHidden()
    const row = page.getByRole('row').filter({ hasText: newEmail })
    await expect(row.getByRole('cell', { name: 'After Edit', exact: true })).toBeVisible()
    await expect(page.getByRole('row').filter({ hasText: email })).toHaveCount(0)
  })

  test('validates the edit form and rejects an email already in use', async ({ page }) => {
    const email = `edit-check-${Date.now()}@example.com`
    await page.request.post('/api/users', { data: { name: 'Edit Check', email, password: 'password123' } })

    await page.goto('/users')
    await page.getByRole('button', { name: `Edit ${email}` }).click()
    const dialog = page.getByRole('dialog', { name: 'Edit user' })

    await dialog.getByLabel('Name').fill('')
    await dialog.getByLabel('Password').fill('short')
    await dialog.getByRole('button', { name: 'Save changes' }).click()
    await expect(dialog.getByText('Name is required')).toBeVisible()
    await expect(dialog.getByText('Password must be at least 8 characters')).toBeVisible()

    await dialog.getByLabel('Name').fill('Edit Check')
    await dialog.getByLabel('Password').fill('')
    await dialog.getByLabel('Email').fill(testAdmin.email)
    await dialog.getByRole('button', { name: 'Save changes' }).click()
    await expect(dialog.getByText('A user with this email already exists')).toBeVisible()
  })

  test('API rejects invalid input', async ({ page }) => {
    const res = await page.request.post('/api/users', {
      data: { name: '', email: 'bad', password: 'x' },
    })
    expect(res.status()).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('Invalid input')
    expect(Object.keys(body.fields).sort()).toEqual(['email', 'name', 'password'])
  })
})

test.describe('users API', () => {
  test('rejects unauthenticated requests', async ({ request }) => {
    const res = await request.get('/api/users')
    expect(res.status()).toBe(401)
    expect(await res.json()).toEqual({ error: 'Unauthorized' })
  })

  test('rejects unauthenticated edit requests', async ({ request }) => {
    const res = await request.patch('/api/users/any-id', {
      data: { name: 'X', email: 'x@example.com' },
    })
    expect(res.status()).toBe(401)
  })

  test('rejects unauthenticated delete requests', async ({ request }) => {
    expect((await request.delete('/api/users/any-id')).status()).toBe(401)
  })

  test('rejects unauthenticated create requests', async ({ request }) => {
    const res = await request.post('/api/users', {
      data: { name: 'X', email: 'x@example.com', password: 'password123' },
    })
    expect(res.status()).toBe(401)
  })
})
