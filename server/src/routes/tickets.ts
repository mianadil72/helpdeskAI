import { Router } from 'express'
import { z } from 'zod'
import {
  ticketListQuerySchema,
  updateTicketSchema,
  type AssigneesResponse,
  type TicketListItem,
  type TicketResponse,
  type TicketSortField,
  type TicketsResponse,
} from '@helpdesk/shared'
import { prisma } from '../db.js'
import type { Prisma } from '../generated/prisma/client.js'
import { requireAuth } from '../middleware/auth.js'

// Tickets; every signed-in user (admin or agent) works them.
export const ticketsRouter = Router()

ticketsRouter.use(requireAuth)

// Filtered, searched, sorted and paginated list. Bad query values fall back to
// defaults (see ticketListQuerySchema), so this never 400s.
ticketsRouter.get('/', async (req, res) => {
  const { status, category, q, sort, order, page, pageSize } = ticketListQuerySchema.parse(req.query)

  const where = {
    status,
    category,
    ...(q && {
      OR: [
        { subject: { contains: q, mode: 'insensitive' as const } },
        { requesterEmail: { contains: q, mode: 'insensitive' as const } },
        { requesterName: { contains: q, mode: 'insensitive' as const } },
      ],
    }),
  }

  const [tickets, total] = await prisma.$transaction([
    prisma.ticket.findMany({
      where,
      orderBy: ticketOrderBy(sort, order),
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        subject: true,
        requesterEmail: true,
        requesterName: true,
        status: true,
        category: true,
        createdAt: true,
        updatedAt: true,
        assignee: { select: { id: true, name: true } },
        _count: { select: { messages: true } },
      },
    }),
    prisma.ticket.count({ where }),
  ])

  const body: TicketsResponse = {
    tickets: tickets.map(
      ({ _count, createdAt, updatedAt, ...ticket }): TicketListItem => ({
        ...ticket,
        messageCount: _count.messages,
        createdAt: createdAt.toISOString(),
        updatedAt: updatedAt.toISOString(),
      }),
    ),
    total,
    page,
    pageSize,
  }
  res.json(body)
})

// Users a ticket can be assigned to: everyone who isn't deleted. Defined
// before /:id so "assignees" isn't taken for a ticket id.
ticketsRouter.get('/assignees', async (_req, res) => {
  const users = await prisma.user.findMany({
    where: { deletedAt: null },
    select: { id: true, name: true, email: true },
    orderBy: { name: 'asc' },
  })
  const body: AssigneesResponse = { users }
  res.json(body)
})

ticketsRouter.get('/:id', async (req, res) => {
  const ticket = await findTicket(req.params.id)
  if (!ticket) {
    res.status(404).json({ error: 'Ticket not found' })
    return
  }
  const body: TicketResponse = { ticket }
  res.json(body)
})

// Changes any of status, category and assignee (null unassigns).
ticketsRouter.patch('/:id', async (req, res) => {
  const parsed = updateTicketSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid input', fields: z.flattenError(parsed.error).fieldErrors })
    return
  }
  const { status, category, assigneeId } = parsed.data
  const { id } = req.params

  if (assigneeId) {
    const assignee = await prisma.user.findFirst({ where: { id: assigneeId, deletedAt: null }, select: { id: true } })
    if (!assignee) {
      res.status(400).json({ error: 'Invalid input', fields: { assigneeId: ['Unknown user'] } })
      return
    }
  }

  const { count } = await prisma.ticket.updateMany({ where: { id }, data: { status, category, assigneeId } })
  if (count === 0) {
    res.status(404).json({ error: 'Ticket not found' })
    return
  }

  const ticket = await findTicket(id)
  if (!ticket) {
    // Deleted between the update and the read.
    res.status(404).json({ error: 'Ticket not found' })
    return
  }
  const body: TicketResponse = { ticket }
  res.json(body)
})

// Tickets without a requester name sort last either way; unassigned tickets
// sort like Postgres NULLs (last ascending, first descending). The newest-first
// and id tiebreakers keep pages stable when values are equal.
function ticketOrderBy(sort: TicketSortField, order: 'asc' | 'desc'): Prisma.TicketOrderByWithRelationInput[] {
  const tiebreakers: Prisma.TicketOrderByWithRelationInput[] = [{ createdAt: 'desc' }, { id: 'desc' }]
  switch (sort) {
    case 'createdAt':
    case 'updatedAt':
      return [{ [sort]: order }, { id: order }]
    case 'requester':
      return [{ requesterName: { sort: order, nulls: 'last' } }, { requesterEmail: order }, ...tiebreakers]
    case 'assignee':
      return [{ assignee: { name: order } }, ...tiebreakers]
    default:
      return [{ [sort]: order }, ...tiebreakers]
  }
}

async function findTicket(id: string): Promise<TicketResponse['ticket'] | null> {
  const ticket = await prisma.ticket.findUnique({
    where: { id },
    select: {
      id: true,
      subject: true,
      requesterEmail: true,
      requesterName: true,
      status: true,
      category: true,
      summary: true,
      createdAt: true,
      updatedAt: true,
      assignee: { select: { id: true, name: true } },
      messages: {
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: { id: true, direction: true, fromEmail: true, fromName: true, body: true, createdAt: true },
      },
    },
  })
  if (!ticket) return null
  return {
    ...ticket,
    createdAt: ticket.createdAt.toISOString(),
    updatedAt: ticket.updatedAt.toISOString(),
    messages: ticket.messages.map((message) => ({ ...message, createdAt: message.createdAt.toISOString() })),
  }
}
