## Tech Stack

TypeScript end to end: React frontend, Node API, PostgreSQL, and the Claude API.

## Overview

| Layer | Choice | Why |
|---|---|---|
| **Frontend** | React + Vite + TypeScript | Internal tool behind a login; no need for server-side rendering |
| **UI** | Tailwind CSS + shadcn/ui | Fast to build, professional look, components live in the codebase |
| **Tables & data fetching** | TanStack Table + TanStack Query | Ticket list filtering/sorting; caching and refetching |
| **Backend** | Node.js + Express (TypeScript) | REST API, email webhooks, admin endpoints |
| **Validation** | Zod | Shared schemas between client and server; validates AI output |
| **Database** | PostgreSQL + Prisma | Relational data; ticket statuses and categories as enums |
| **Background jobs** | pg-boss | Async AI calls and outbound email with retries; runs on Postgres, no Redis |
| **Authentication** | Database sessions (Better Auth) | See below |
| **Email** | Postmark or SendGrid (inbound webhook + outbound) | Inbound mail posted to the API as JSON; handles deliverability |
| **AI** | Claude API (Anthropic TypeScript SDK) | See below |
| **Testing** | Vitest + Playwright | Unit/API tests and end-to-end tests |
| **Deployment** | Docker + Render, Railway or Fly.io | API container + managed Postgres |

## Authentication

Authentication uses **database sessions**, not JWTs.

- On login, a session record is created in a `sessions` table in Postgres (session ID, user ID, expiry, created at).
- The browser receives only an opaque session ID in an `httpOnly`, `Secure`, `SameSite=Lax` cookie.
- Every authenticated request looks up the session in the database and loads the user and role.
- Logging out deletes the session row. Deactivating an agent deletes all of their sessions, so access is revoked immediately.
- Passwords are hashed (Better Auth default hashing, or bcrypt/argon2 if hand-rolled).
- Roles: `admin` and `agent`. Admin-only routes (user management) are enforced on the server.
- The initial admin is created at deployment from environment variables (e.g. `ADMIN_EMAIL`, `ADMIN_PASSWORD`) via a seed script. The admin creates additional agents.

## AI

- **Classification and summaries:** Claude Haiku 4.5 (`claude-haiku-4-5-20251001`). Returns structured JSON (category, confidence) validated with Zod.
- **Reply drafts:** Claude Sonnet 5.5 (`claude-sonnet-5-5`). Higher-quality writing for text students read.
- **Knowledge base:** for v1, include the full knowledge base in the prompt and use prompt caching. Add retrieval (pgvector in the same Postgres database) only if the knowledge base outgrows the context.
- **Logging:** store the model, prompt version, and whether the agent accepted or edited each AI draft, to measure accuracy over time.

## Project Structure

```
/client   React + Vite
/server   Express API, background jobs, email, AI
/shared   Zod schemas and types (status and category enums)
```

## Open Decisions

- **Email provider:** Postmark/SendGrid, or Microsoft Graph/Gmail API if the support inbox must stay in an existing mailbox.
- **SSO:** if agents must log in with university single sign-on, authentication needs an SSO-capable setup.
- **Data residency:** where student data may be hosted and whether it may be sent to an external AI provider.
