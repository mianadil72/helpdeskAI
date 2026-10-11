import { expect, test } from '@playwright/test'
import { adminStorageState, baseURL, testAdmin } from './test-env'

// One sign-in here (the new agent); retries stay off so CI retries can't eat
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

  test('creates a new agent from the modal, who can then sign in', async ({ page, playwright }) => {
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
    await agent.dispose()
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

  test('rejects unauthenticated create requests', async ({ request }) => {
    const res = await request.post('/api/users', {
      data: { name: 'X', email: 'x@example.com', password: 'password123' },
    })
    expect(res.status()).toBe(401)
  })
})
