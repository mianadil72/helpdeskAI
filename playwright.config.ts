import { defineConfig, devices } from '@playwright/test'
import { apiURL, baseURL, clientPort, serverDir, serverEnv } from './e2e/test-env'

// End-to-end tests run against their own API server (port 3001) and Vite
// server (port 5174) backed by the database in server/.env.test, so they can
// run alongside `npm run dev`. Run with `npm run test:e2e`, which builds
// `shared` first.
export default defineConfig({
  testDir: './e2e',
  // Tests share one database, so run them one at a time.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'html',
  globalSetup: './e2e/global-setup.ts',
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      name: 'api',
      // Applies migrations to the test database (creating it if needed), then
      // starts the API without --env-file, so the app never reads server/.env.
      // No `prisma generate`: it would rewrite the client a running dev server
      // watches; `npm run dev` / `typecheck` / `build` generate it.
      command: 'npx prisma migrate deploy && node --import tsx src/index.ts',
      cwd: serverDir,
      env: serverEnv,
      url: `${apiURL}/api/health`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      name: 'client',
      command: `npm run dev -w client -- --port ${clientPort} --strictPort`,
      env: { API_PROXY_TARGET: apiURL },
      url: baseURL,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
})
