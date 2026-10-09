import { expect, test } from '@playwright/test'
import { adminStorageState, testAdmin } from './test-env'

// No sign-ins here (the setup project signs in), but keep retries off like
// the other signed-in specs so CI retries can't eat the sign-in budget.
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
})

test.describe('users API', () => {
  test('rejects unauthenticated requests', async ({ request }) => {
    const res = await request.get('/api/users')
    expect(res.status()).toBe(401)
    expect(await res.json()).toEqual({ error: 'Unauthorized' })
  })
})
