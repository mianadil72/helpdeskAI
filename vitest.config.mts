import { defineConfig } from 'vitest/config'

// Unit tests (`npm test`). Each workspace has its own vitest.config.ts; e2e/
// is Playwright's and isn't listed here.
export default defineConfig({
  test: {
    projects: ['shared', 'server', 'client'],
  },
})
