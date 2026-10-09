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
