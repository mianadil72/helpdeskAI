import { expect, test, type Page } from '@playwright/test'
import { testAdmin } from './test-env'

// Sign-in is rate-limited to 5 requests per minute per IP, shared by the whole
// run. This file makes exactly 2 sign-in requests (wrong password + success);
// the validation tests are stopped client-side and never reach the server.

function countSignInRequests(page: Page) {
  const counter = { count: 0 }
  page.on('request', (req) => {
    if (req.url().includes('/api/auth/sign-in')) counter.count++
  })
  return counter
}

test.describe('login page', () => {
  test('redirects an unauthenticated visit to / to /login', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveURL(/\/login$/)
    await expect(page.getByText('Welcome back')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible()
  })

  test('shows field errors for an empty form without signing in', async ({ page }) => {
    const signIns = countSignInRequests(page)
    await page.goto('/login')

    await page.getByRole('button', { name: 'Sign in' }).click()

    await expect(page.getByText('Email is required')).toBeVisible()
    await expect(page.getByText('Password is required')).toBeVisible()
    await expect(page.getByLabel('Email')).toHaveAttribute('aria-invalid', 'true')
    await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute('aria-invalid', 'true')
    await expect(page).toHaveURL(/\/login$/)
    expect(signIns.count).toBe(0)
  })

  test('shows field errors for an invalid email and empty password without signing in', async ({
    page,
  }) => {
    const signIns = countSignInRequests(page)
    await page.goto('/login')

    await page.getByLabel('Email').fill('not-an-email')
    await page.getByRole('button', { name: 'Sign in' }).click()

    await expect(page.getByText('Enter a valid email address')).toBeVisible()
    await expect(page.getByText('Password is required')).toBeVisible()
    await expect(page.getByLabel('Email')).toHaveAttribute('aria-invalid', 'true')
    await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute('aria-invalid', 'true')
    await expect(page).toHaveURL(/\/login$/)
    expect(signIns.count).toBe(0)

    // Fixing the fields clears their errors.
    await page.getByLabel('Email').fill(testAdmin.email)
    await page.getByLabel('Password', { exact: true }).fill('something')
    await expect(page.getByText('Enter a valid email address')).toBeHidden()
    await expect(page.getByText('Password is required')).toBeHidden()
  })

  test('toggles password visibility', async ({ page }) => {
    await page.goto('/login')
    const password = page.getByLabel('Password', { exact: true })
    await password.fill('secret')
    await expect(password).toHaveAttribute('type', 'password')

    await page.getByRole('button', { name: 'Show password' }).click()
    await expect(password).toHaveAttribute('type', 'text')

    await page.getByRole('button', { name: 'Hide password' }).click()
    await expect(password).toHaveAttribute('type', 'password')
  })

  test('shows an error for a wrong password and stays on /login', async ({ page }) => {
    await page.goto('/login')
    await page.getByLabel('Email').fill(testAdmin.email)
    await page.getByLabel('Password', { exact: true }).fill(`${testAdmin.password}-wrong`)
    await page.getByRole('button', { name: 'Sign in' }).click()

    await expect(page.getByRole('alert')).toHaveText('Invalid email or password')
    await expect(page).toHaveURL(/\/login$/)
    await expect(page.getByRole('button', { name: 'Sign out' })).toBeHidden()
  })

  // One sign-in covers the signed-in header, the /login redirect and sign-out.
  test('signs in as the admin, redirects /login while signed in, then signs out', async ({
    page,
  }) => {
    await page.goto('/login')
    await page.getByLabel('Email').fill(testAdmin.email)
    await page.getByLabel('Password', { exact: true }).fill(testAdmin.password)
    await page.getByRole('button', { name: 'Sign in' }).click()

    await expect(page).toHaveURL(/\/$/)
    await expect(page.getByRole('heading', { name: 'Home' })).toBeVisible()
    const header = page.getByRole('banner')
    await expect(header.getByText(testAdmin.name, { exact: true })).toBeVisible()
    await expect(header.getByRole('link', { name: 'Users' })).toBeVisible()
    await expect(header.getByRole('button', { name: 'Sign out' })).toBeVisible()

    await page.goto('/login')
    await expect(page).toHaveURL(/\/$/)
    await expect(page.getByRole('heading', { name: 'Home' })).toBeVisible()

    await header.getByRole('button', { name: 'Sign out' }).click()
    await expect(page).toHaveURL(/\/login$/)
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible()

    // The session is really gone: protected pages send us back to /login.
    await page.goto('/')
    await expect(page).toHaveURL(/\/login$/)
  })
})
