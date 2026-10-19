import { z } from 'zod'

export interface HealthResponse {
  status: 'ok' | 'error'
  database: 'ok' | 'error'
  timestamp: string
}

export type Role = 'admin' | 'agent'

// Row in the admin user list (GET /api/users).
export interface UserListItem {
  id: string
  name: string
  email: string
  role: Role
  createdAt: string
}

export interface UsersResponse {
  users: UserListItem[]
}

// User form rules, shared so the client form and the server validate the same
// way. Password limits match Better Auth's defaults (8–128), so users can sign
// in with the password an admin sets.
const nameSchema = z
  .string()
  .trim()
  .min(1, 'Name is required')
  .max(100, 'Name must be at most 100 characters')

const emailSchema = z
  .string()
  .trim()
  .min(1, 'Email is required')
  .pipe(z.email('Enter a valid email address'))
  .transform((email) => email.toLowerCase())

const PASSWORD_MIN = 8
const PASSWORD_MIN_MESSAGE = `Password must be at least ${PASSWORD_MIN} characters`
const PASSWORD_MAX_MESSAGE = 'Password must be at most 128 characters'

// Body of POST /api/users (admin creates an agent).
export const createUserSchema = z.object({
  name: nameSchema,
  email: emailSchema,
  password: z.string().min(PASSWORD_MIN, PASSWORD_MIN_MESSAGE).max(128, PASSWORD_MAX_MESSAGE),
})

export type CreateUserInput = z.input<typeof createUserSchema>

export interface CreateUserResponse {
  user: UserListItem
}

// Body of PATCH /api/users/:id (admin edits a user). The password is optional:
// blank or missing keeps the current one, anything else replaces it.
export const updateUserSchema = z.object({
  name: nameSchema,
  email: emailSchema,
  password: z
    .string()
    .max(128, PASSWORD_MAX_MESSAGE)
    .refine((password) => password === '' || password.length >= PASSWORD_MIN, PASSWORD_MIN_MESSAGE)
    .optional()
    .transform((password) => password || undefined),
})

export type UpdateUserInput = z.input<typeof updateUserSchema>

export interface UpdateUserResponse {
  user: UserListItem
}

// Tickets
export const TICKET_STATUSES = ['open', 'resolved', 'closed'] as const
export type TicketStatus = (typeof TICKET_STATUSES)[number]

export const TICKET_CATEGORIES = ['general_question', 'technical_question', 'refund_request'] as const
export type TicketCategory = (typeof TICKET_CATEGORIES)[number]

// Message-IDs are compared without their angle brackets: "<a@b>" and "a@b" match.
const messageIdSchema = z
  .string()
  .trim()
  .transform((id) => id.replace(/^<|>$/g, '').trim())
  .pipe(z.string().min(1, 'Message-ID is required').max(998))

// Body of POST /api/inbound/email: one received email, in our own
// provider-neutral format. A provider adapter (Postmark, SendGrid, a mailbox
// poller, …) translates its payload into this shape.
export const inboundEmailSchema = z
  .object({
    from: z.object({
      email: emailSchema,
      name: z
        .string()
        .trim()
        .max(200)
        .optional()
        .transform((name) => name || undefined),
    }),
    subject: z
      .string()
      .trim()
      .max(998)
      .optional()
      .transform((subject) => subject || '(no subject)'),
    text: z.string().optional(),
    html: z.string().optional(),
    messageId: messageIdSchema,
    inReplyTo: messageIdSchema.optional(),
    references: z.array(messageIdSchema).max(100).optional(),
    // Raw headers, used to spot auto-replies; keys are lower-cased.
    headers: z
      .record(z.string(), z.string())
      .optional()
      .transform((headers) =>
        Object.fromEntries(Object.entries(headers ?? {}).map(([k, v]) => [k.toLowerCase(), v])),
      ),
  })
  .refine((email) => Boolean(email.text?.trim() || email.html?.trim()), {
    message: 'The email has no body',
    path: ['text'],
  })

export type InboundEmailInput = z.input<typeof inboundEmailSchema>
export type InboundEmail = z.output<typeof inboundEmailSchema>

export interface InboundEmailResponse {
  // created: new ticket; appended: added to an existing ticket; duplicate: this
  // Message-ID was already received; ignored: auto-reply or bounce.
  result: 'created' | 'appended' | 'duplicate' | 'ignored'
  ticketId?: string
  messageId?: string
}

// Query string of GET /api/tickets. Invalid or missing values fall back to the
// defaults rather than failing, since they come from a user-editable URL.
// Sort fields match the ticket table's column ids. Status and category sort in
// the order of TICKET_STATUSES / TICKET_CATEGORIES (their database enum order).
export const TICKET_SORT_FIELDS = [
  'subject',
  'requester',
  'status',
  'category',
  'assignee',
  'createdAt',
  'updatedAt',
] as const
export type TicketSortField = (typeof TICKET_SORT_FIELDS)[number]
export const TICKET_PAGE_SIZES = [10, 20, 50] as const

export const ticketListQuerySchema = z.object({
  status: z.enum(TICKET_STATUSES).optional().catch(undefined),
  category: z.enum(TICKET_CATEGORIES).optional().catch(undefined),
  q: z
    .string()
    .trim()
    .max(200)
    .optional()
    .catch(undefined)
    .transform((q) => q || undefined),
  sort: z.enum(TICKET_SORT_FIELDS).catch('createdAt'),
  order: z.enum(['asc', 'desc']).catch('desc'),
  page: z.coerce.number().int().min(1).catch(1),
  pageSize: z.coerce
    .number()
    .refine((size) => (TICKET_PAGE_SIZES as readonly number[]).includes(size))
    .catch(20),
})

export type TicketListQuery = z.output<typeof ticketListQuerySchema>

// Row in the ticket list.
export interface TicketListItem {
  id: string
  subject: string
  requesterEmail: string
  requesterName: string | null
  status: TicketStatus
  category: TicketCategory
  assignee: { id: string; name: string } | null
  messageCount: number
  createdAt: string
  updatedAt: string
}

export interface TicketsResponse {
  tickets: TicketListItem[]
  total: number
  page: number
  pageSize: number
}

export type MessageDirection = 'inbound' | 'outbound'

// One email in a ticket's thread, oldest first.
export interface TicketMessage {
  id: string
  direction: MessageDirection
  fromEmail: string
  fromName: string | null
  body: string
  createdAt: string
}

// GET /api/tickets/:id (and the PATCH response).
export interface TicketDetail extends Omit<TicketListItem, 'messageCount'> {
  summary: string | null
  messages: TicketMessage[]
}

export interface TicketResponse {
  ticket: TicketDetail
}

// Body of PATCH /api/tickets/:id: any of status, category and assignee
// (null unassigns).
export const updateTicketSchema = z
  .object({
    status: z.enum(TICKET_STATUSES),
    category: z.enum(TICKET_CATEGORIES),
    assigneeId: z.string().min(1).nullable(),
  })
  .partial()
  .refine((body) => Object.values(body).some((value) => value !== undefined), {
    message: 'Nothing to update',
  })

export type UpdateTicketInput = z.input<typeof updateTicketSchema>

// Body of POST /api/tickets/:id/replies: an agent's plain-text reply, and
// whether to mark the ticket resolved with it ("Send & resolve"). The client
// form uses the same schema.
export const MAX_REPLY_LENGTH = 50_000

export const createReplySchema = z.object({
  body: z
    .string()
    .trim()
    .min(1, 'Write a reply')
    .max(MAX_REPLY_LENGTH, `Keep replies under ${MAX_REPLY_LENGTH.toLocaleString('en-US')} characters`),
  resolve: z.boolean().default(false),
})

export type CreateReplyInput = z.input<typeof createReplySchema>
export type CreateReply = z.output<typeof createReplySchema>

// GET /api/tickets/assignees: users a ticket can be assigned to.
export interface AssigneesResponse {
  users: { id: string; name: string; email: string }[]
}
