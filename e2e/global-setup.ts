import { execSync, type ExecSyncOptions } from 'node:child_process'
import { serverDir, serverEnv } from './test-env'

// Truncates every table except Prisma's migration history.
const truncateAll = `
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT tablename FROM pg_tables
           WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  LOOP
    EXECUTE format('TRUNCATE TABLE %I CASCADE', r.tablename);
  END LOOP;
END $$;
`

// Runs after the web servers start (which applied migrations to the test
// database): wipes all data, then seeds the admin, so each run starts clean.
export default function globalSetup() {
  const options: ExecSyncOptions = {
    cwd: serverDir,
    env: { ...process.env, ...serverEnv },
    stdio: ['pipe', 'inherit', 'inherit'],
  }
  execSync('npx prisma db execute --stdin', { ...options, input: truncateAll })
  execSync('node --import tsx src/seed.ts', options)
}
