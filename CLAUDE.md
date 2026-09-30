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

## Domain rules

- Ticket statuses: `open`, `resolved`, `closed`.
- Ticket categories (exactly one per ticket): `general_question`, `technical_question`, `refund_request`.
- Roles: `admin`, `agent`. The initial admin is seeded at deploy; only admins manage users.
- Authentication uses database sessions (session rows in Postgres, opaque ID in an httpOnly cookie), not JWTs.
- AI replies are drafts that an agent approves; the manual workflow must keep working if the AI provider fails.
