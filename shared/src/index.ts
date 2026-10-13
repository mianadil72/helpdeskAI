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
