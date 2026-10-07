import { readFileSync } from 'node:fs'
import path from 'node:path'
import { parseEnv } from 'node:util'

export const serverDir = path.join(__dirname, '..', 'server')

export const clientPort = 5174
export const baseURL = `http://localhost:${clientPort}`

// Settings for the test API server, read from server/.env.test (git-ignored;
// copy server/.env.test.example). Kept apart from server/.env so tests never
// touch the dev database.
function loadTestEnv() {
  const file = path.join(serverDir, '.env.test')
  let contents: string
  try {
    contents = readFileSync(file, 'utf8')
  } catch {
    throw new Error(`Missing ${file}; copy server/.env.test.example and fill it in`)
  }
  const env = parseEnv(contents) as Record<string, string | undefined>

  // DATABASE_URL must stay required: the Prisma CLI also loads server/.env
  // (prisma.config.ts), and only a value set here keeps it off the dev database.
  for (const key of ['DATABASE_URL', 'BETTER_AUTH_SECRET', 'ADMIN_EMAIL', 'ADMIN_PASSWORD']) {
    if (!env[key]) throw new Error(`${key} must be set in server/.env.test`)
  }
  // Every run wipes this database, so refuse anything that isn't clearly a test one.
  const dbName = new URL(env.DATABASE_URL!).pathname.slice(1)
  if (!dbName.endsWith('_test')) {
    throw new Error(`DATABASE_URL in server/.env.test must name a *_test database (got "${dbName}")`)
  }

  // Mismatched URLs make sign-in fail with an unhelpful origin error.
  const apiURL = `http://localhost:${env.PORT ?? 3001}`
  if (env.BETTER_AUTH_URL !== apiURL) {
    throw new Error(`BETTER_AUTH_URL in server/.env.test must be ${apiURL} (to match PORT)`)
  }
  const origins = (env.TRUSTED_ORIGINS ?? '').split(',').map((o) => o.trim())
  if (!origins.includes(baseURL)) {
    throw new Error(`TRUSTED_ORIGINS in server/.env.test must include ${baseURL}`)
  }
  return env as Record<string, string>
}

export const testEnv = loadTestEnv()

export const apiPort = Number(testEnv.PORT ?? 3001)
export const apiURL = `http://localhost:${apiPort}`

// Environment for test-server processes. Playwright and child_process both
// start from the shell's environment, so blank out variables that would change
// the server's behaviour if exported there but missing from .env.test.
// Add new optional server settings here (e.g. AI provider keys).
export const serverEnv: Record<string, string> = {
  NODE_ENV: 'test',
  TRUST_PROXY: '',
  ...testEnv,
  PORT: String(apiPort),
}

// The seeded admin, for tests that need to sign in.
export const testAdmin = {
  email: testEnv.ADMIN_EMAIL,
  password: testEnv.ADMIN_PASSWORD,
  name: testEnv.ADMIN_NAME ?? 'Admin',
}
