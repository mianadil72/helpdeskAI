import type { TicketCategory, TicketStatus } from '@helpdesk/shared'

export const ticketStatusLabels: Record<TicketStatus, string> = {
  open: 'Open',
  resolved: 'Resolved',
  closed: 'Closed',
}

export const ticketStatusBadge: Record<TicketStatus, 'default' | 'secondary' | 'outline'> = {
  open: 'default',
  resolved: 'secondary',
  closed: 'outline',
}

export const ticketCategoryLabels: Record<TicketCategory, string> = {
  general_question: 'General question',
  technical_question: 'Technical question',
  refund_request: 'Refund request',
}
