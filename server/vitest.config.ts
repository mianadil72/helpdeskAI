import { defineConfig } from 'vitest/config'

// Unit tests mock `auth` and `db`, so they need no database or env file.
export default defineConfig({
  test: {
    name: 'server',
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
})
