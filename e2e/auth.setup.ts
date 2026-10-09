import { expect, test as setup } from '@playwright/test'
import { adminStorageState, baseURL, testAdmin } from './test-env'

// Signs in once as the seeded admin and saves the session cookie, so specs
// that need a signed-in admin don't each spend a rate-limited sign-in.
// Retries are off: a retry would repeat the sign-in (see login.spec.ts).
setup.describe.configure({ retries: 0 })

setup('sign in as admin', async ({ request }) => {
  const res = await request.post('/api/auth/sign-in/email', {
    data: { email: testAdmin.email, password: testAdmin.password },
    headers: { Origin: baseURL },
  })
  expect(res.ok()).toBe(true)
  await request.storageState({ path: adminStorageState })
})
