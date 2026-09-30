export interface HealthResponse {
  status: 'ok' | 'error'
  database: 'ok' | 'error'
  timestamp: string
}
