## Implementation Plan

Based on `project-scope.md` and `tech-stack.md`. Each phase ends with something working and testable. Tasks are small enough to complete and verify individually.

## Assumptions

- AI replies are **drafts that an agent approves** before sending. Auto-sending without review comes last (Phase 9) and is gated.
- The knowledge base starts as Markdown files in a `/knowledge-base` folder, loaded into the prompt with prompt caching.
- Routing in v1 = category assignment + manual assignment of a ticket to an agent.

---

## Phase 1 — Project Setup

- [ ] Create monorepo with `/client`, `/server`, `/shared` (npm workspaces)
- [ ] Configure TypeScript, ESLint and Prettier across all packages
- [ ] Scaffold client with React + Vite + Tailwind + shadcn/ui
- [ ] Scaffold server with Express + TypeScript, `GET /health` endpoint
- [ ] Add Docker Compose with PostgreSQL for local development
- [ ] Set up Prisma and connect to the database
- [ ] Add environment variable loading and validation with Zod (`.env.example`)
- [ ] Set up Vitest in server and client with one passing test each
- [ ] Set up Playwright with one smoke test (app loads)
- [ ] Initialize git repository and first commit

**Done when:** client and server run locally, talk to each other, and tests pass.

## Phase 2 — Authentication (Database Sessions)

- [ ] Prisma models: `User` (email, name, password hash, role `admin | agent`, active flag) and `Session`
- [x] Integrate Better Auth with database-backed sessions in Postgres
- [x] Session cookie: `httpOnly`, `Secure`, `SameSite=Lax`
- [x] Seed script that creates the initial admin from `ADMIN_EMAIL` / `ADMIN_PASSWORD`
- [ ] Auth middleware: `requireAuth` and `requireRole('admin')`
- [ ] Login page
- [ ] Logout (deletes session row)
- [ ] Protected routes on the client; redirect to login when unauthenticated
- [ ] App layout with navigation and current user display
- [ ] Tests: login success/failure, protected route access, logout invalidates session

**Done when:** the seeded admin can log in and out; unauthenticated users are blocked.

## Phase 3 — User Management (Admin Only)

- [ ] API: list users
- [ ] API: create agent (name, email, initial password)
- [ ] API: edit agent (name, email)
- [ ] API: deactivate / reactivate agent (deactivation deletes all their sessions)
- [ ] Prevent the admin from deactivating themselves
- [ ] Users page: table of users
- [ ] Create / edit agent form with validation
- [ ] Deactivate / reactivate action with confirmation
- [ ] Hide user management from agents in the UI (server already enforces it)
- [ ] Tests: agent cannot access user endpoints; deactivated agent is logged out and cannot log in

**Done when:** the admin can create agents, and those agents can log in.

## Phase 4 — Tickets Core

- [ ] Shared enums in `/shared`: status (`open`, `resolved`, `closed`) and category (`general_question`, `technical_question`, `refund_request`)
- [ ] Prisma models: `Ticket` (subject, student email/name, status, category, assigned agent, summary, timestamps) and `Message` (ticket, direction inbound/outbound, author, body, email message ID, timestamp)
- [ ] Seed script with sample tickets for development
- [ ] API: list tickets with filtering (status, category, assignee) and sorting (created, updated)
- [ ] API: pagination for ticket list
- [ ] API: get ticket with its messages
- [ ] API: update status
- [ ] API: update category (manual override)
- [ ] API: assign ticket to an agent
- [ ] Ticket list page with TanStack Table: columns, filters, sorting, pagination
- [ ] Search tickets by subject or student email
- [ ] Ticket detail page: message thread, status, category, assignee
- [ ] Status, category and assignee controls on the detail page
- [ ] Tests: filtering, sorting, status and category updates

**Done when:** agents can browse, filter and manage seeded tickets.

## Phase 5 — Email Integration

- [ ] Choose email provider (Postmark or SendGrid) and set up the support address
- [ ] Configure domain authentication (SPF, DKIM) for outbound mail
- [ ] Inbound webhook endpoint that verifies the request is from the provider
- [ ] Parse inbound email into a new ticket + first message
- [ ] Thread replies: match `In-Reply-To` / `References` headers to an existing ticket and append a message
- [ ] Reopen a resolved ticket when the student replies
- [ ] Ignore auto-replies and bounces (e.g. `Auto-Submitted` header) to prevent mail loops
- [ ] Store attachment metadata (file handling can come later)
- [ ] Set up pg-boss for background jobs
- [ ] Reply composer on the ticket detail page
- [ ] Send agent replies as email via a background job, with retries
- [ ] Set outbound headers so student replies thread back to the ticket
- [ ] Tests: new email creates ticket, reply appends to existing ticket, auto-replies ignored

**Done when:** a real email creates a ticket, an agent replies from the app, and the student's reply lands on the same ticket.

## Phase 6 — AI Classification and Summaries

- [ ] Set up Anthropic SDK and API key configuration
- [ ] Prisma model `AiRun` to log every AI call (ticket, task type, model, prompt version, output, tokens, latency)
- [ ] Classification prompt returning JSON (category, confidence), validated with Zod
- [ ] Background job: classify each new ticket on creation
- [ ] Show AI category and confidence on the ticket; agent can override
- [ ] Record agent overrides to measure classification accuracy
- [ ] Summary prompt for a ticket's message thread
- [ ] Background job: generate/refresh summary when a new message arrives
- [ ] Show summary on the ticket detail page
- [ ] Graceful failure: if the AI call fails, the ticket still works and the job retries
- [ ] Tests with a mocked AI client (valid output, invalid output, API failure)

**Done when:** new tickets are classified and summarized automatically, and failures don't break anything.

## Phase 7 — Knowledge Base and AI-Suggested Replies

- [ ] Create `/knowledge-base` folder with initial Markdown articles
- [ ] Load knowledge base at startup and build the cached system prompt
- [ ] Reply-drafting prompt: answer only from the knowledge base; say when it can't answer
- [ ] Generate a suggested reply (Claude Sonnet 5.5) on demand from the ticket detail page
- [ ] Insert suggestion into the reply composer for the agent to edit before sending
- [ ] Record whether the agent sent the draft unchanged, edited it, or discarded it
- [ ] "Regenerate" action for a new suggestion
- [ ] Tests: draft generation, knowledge-base-missing response, logging of outcome

**Done when:** agents get useful drafts grounded in the knowledge base and every outcome is logged.

## Phase 8 — Dashboard

- [ ] API: ticket counts by status and by category
- [ ] API: average time to first response and to resolution
- [ ] API: AI metrics — classification override rate, draft acceptance rate
- [ ] Dashboard page with stat tiles and charts
- [ ] Date range filter
- [ ] Links from dashboard figures to the filtered ticket list

**Done when:** the admin can see how the help desk and the AI are performing.

## Phase 9 — Auto-Responses (Gated)

Start only once Phase 7 data shows drafts are reliably accepted unchanged.

- [ ] Admin setting to enable auto-responses per category (off by default)
- [ ] Confidence threshold setting
- [ ] Auto-send only when category is enabled, confidence meets the threshold, and the knowledge base covers the question
- [ ] Never auto-send for refund requests unless explicitly enabled
- [ ] Mark auto-sent messages clearly in the ticket thread
- [ ] Mark ticket as resolved after an auto-response; student reply reopens it
- [ ] Tests: auto-send rules, reopen on reply

**Done when:** simple questions are answered automatically, with a clear audit trail.

## Phase 10 — Hardening and Deployment

- [ ] Automatically close resolved tickets after N days with no reply
- [ ] Rate limiting on login and webhook endpoints
- [ ] Security headers (helmet) and CSRF protection for cookie-based sessions
- [ ] Session expiry and cleanup of expired session rows
- [ ] Structured logging and error tracking
- [ ] Dockerfile for the server; build client as static assets
- [ ] Deploy to hosting provider with managed Postgres
- [ ] Run migrations and admin seed on deploy
- [ ] Database backups
- [ ] CI pipeline: lint, type-check, tests on every push
- [ ] End-to-end test of the full flow: email in → classify → draft → reply → resolve

**Done when:** the system runs in production with backups, monitoring and CI.
