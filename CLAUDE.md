# Helpdesk — AI-Powered Ticket Management System

Support emails become tickets; AI classifies them, summarizes them and drafts replies from a knowledge base; agents review and respond.

Planning docs (read before starting a feature):
- `project-scope.md`: problem, features, ticket statuses/categories, roles
- `tech-stack.md`: chosen stack and rationale (database-session auth, AI models)
- `implementation-plan.md`: phased task list; tick off tasks (`- [x]`) as they are completed

## Documentation lookup

Always use the **Context7 MCP server** (`resolve-library-id` → `query-docs`) to fetch up-to-date documentation before writing or changing code that uses a library, framework, SDK or CLI (Express, React, Vite, Prisma, Better Auth, pg-boss, TanStack, Tailwind, shadcn/ui, Zod, Anthropic SDK, etc.). Do not rely on memory for APIs or configuration; these versions are newer than most training data. Context7 is configured in `.mcp.json`.

## Project structure

npm workspaces monorepo:

```
shared/   @helpdesk/shared: types/schemas shared by client and server; compiles to dist/
server/   @helpdesk/server: Express 5 API (src/app.ts = routes, src/index.ts = startup)
client/   @helpdesk/client: React 19 + Vite 8 SPA; proxies /api to the server
```

## Commands

Run from the repo root:

- `npm run dev`: builds `shared`, then runs shared watcher + server (tsx watch, port 3000) + client (Vite, port 5173 or next free)
- `npm run typecheck`: type-check all packages
- `npm run build`: build shared → server → client
- `npm start`: run the built server

Install packages into a workspace with `npm install <pkg> -w server` (or `-w client`, `-w shared`).

## Conventions

- TypeScript everywhere; strict mode. Server and shared use `nodenext` modules, so relative imports need `.js` extensions (`import { app } from './app.js'`).
- All API routes live under `/api` and are defined in `server/src/app.ts` (or routers it mounts), never in `index.ts`, so the app can be tested without listening on a port.
- Types used by both client and server go in `shared/src` and are imported from `@helpdesk/shared`.
- `shared` must be built before server/client can see changes (`npm run dev` watches it automatically).
- Secrets go in `server/.env` (git-ignored); document new variables in `server/.env.example`.

## Authentication

Better Auth with email/password and database sessions (see the `better-auth-best-practices` skill).

- `server/src/auth.ts`: the `auth` instance, using the Prisma adapter (PostgreSQL). Public sign-up is disabled (`disableSignUp: true`); users are created only on the server (seed script now, admin user-management API later). `role` is an extra user field (`'admin' | 'agent'`, default `agent`, `input: false` so clients can't set it). `trustedOrigins` comes from `TRUSTED_ORIGINS`.
- Tables `User`, `Session`, `Account` (password hash, `providerId: 'credential'`) and `Verification` are in `server/prisma/schema.prisma`.
- `server/src/app.ts` mounts `app.all('/api/auth/*splat', toNodeHandler(auth))` **before** `express.json()` (Better Auth parses its own bodies).
- Protect routes with `requireAuth` from `server/src/middleware/auth.ts`. It calls `auth.api.getSession({ headers: fromNodeHeaders(req.headers) })`, responds 401 `{ error: 'Unauthorized' }` when there is no session, and otherwise sets `res.locals.user` / `res.locals.session` (type `AuthSession`). Admin-only routes must also check `res.locals.user.role === 'admin'`. `GET /api/me` returns the current user and session.
- Initial admin: `npm run db:seed -w server` creates it from `ADMIN_EMAIL` / `ADMIN_PASSWORD` / `ADMIN_NAME`, and skips it if it already exists.
- Env vars (in `server/.env.example`): `BETTER_AUTH_SECRET` (≥32 random chars, e.g. `openssl rand -base64 32`), `BETTER_AUTH_URL` (server URL), `TRUSTED_ORIGINS` (comma-separated client origins, e.g. `http://localhost:5173`).
- Client: `client/src/lib/auth-client.ts` exports `authClient = createAuthClient()` from `better-auth/react` with no `baseURL`, so requests go same-origin to `/api/auth` through the Vite proxy and the cookie stays first-party. Use `authClient.useSession()`, `authClient.signIn.email({ email, password })` and `authClient.signOut()`.
- Client routing (`client/src/App.tsx`): `/login` is public (`LoginPage` redirects to `/` if already signed in), and everything else is wrapped in `RequireAuth` (shows loading while the session is pending, otherwise redirects to `/login`) and `AppLayout` (header with user name and Sign out).
- Sign-in failures return 401 `{ message: 'Invalid email or password', code: 'INVALID_EMAIL_OR_PASSWORD' }`; the login page shows `error.message`.

## Client UI

- Style only with Tailwind v4 utility classes; no custom CSS files or inline `style` props.
- `client/src/index.css` holds the Tailwind import and the default shadcn/ui theme (neutral base color, light/dark CSS variables, Geist font). Keep it: the theme tokens (`bg-primary`, `text-muted-foreground`, `text-destructive`, …) depend on it.
- Use shadcn/ui components from `@/components/ui` (style `radix-nova`, see `client/components.json`); add new ones with `npx shadcn@latest add <component>` from `client/`. Icons come from `lucide-react`.
- Forms use `react-hook-form` with a Zod (v4) schema via `zodResolver`: show each field's error below it (`aria-invalid` + `role="alert"`), and show server errors with `setError('root.serverError', …)`.
- Login form validation checks only that email is valid and password is non-empty; no client-side password length rule.

## Domain rules

- Ticket statuses: `open`, `resolved`, `closed`.
- Ticket categories (exactly one per ticket): `general_question`, `technical_question`, `refund_request`.
- Roles: `admin`, `agent`. The initial admin is seeded at deploy; only admins manage users.
- Authentication uses database sessions (session rows in Postgres, opaque ID in an httpOnly cookie), not JWTs.
- AI replies are drafts that an agent approves; the manual workflow must keep working if the AI provider fails.
