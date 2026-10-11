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

// Body of POST /api/users (admin creates an agent). Shared so the client form
// and the server validate the same rules. Password limits match Better Auth's
// defaults (8–128), so created users can sign in with the same password.
export const createUserSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100, 'Name must be at most 100 characters'),
  email: z
    .string()
    .trim()
    .min(1, 'Email is required')
    .pipe(z.email('Enter a valid email address'))
    .transform((email) => email.toLowerCase()),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(128, 'Password must be at most 128 characters'),
})

export type CreateUserInput = z.input<typeof createUserSchema>

export interface CreateUserResponse {
  user: UserListItem
}
