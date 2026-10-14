import type { InboundEmail, InboundEmailResponse } from '@helpdesk/shared'
import { prisma } from './db.js'

// Turns a received support email into a ticket, or a new message on the ticket
// it replies to. Provider-neutral: callers pass our own InboundEmail shape.
export async function receiveInboundEmail(email: InboundEmail): Promise<InboundEmailResponse> {
  if (isAutoReply(email)) return { result: 'ignored' }

  const existing = await findMessage(email.messageId)
  if (existing) return { result: 'duplicate', ticketId: existing.ticketId, messageId: existing.id }

  const message = {
    direction: 'inbound' as const,
    fromEmail: email.from.email,
    fromName: email.from.name,
    body: emailBody(email),
    emailMessageId: email.messageId,
  }

  try {
    const ticket = await findTicketRepliedTo(email)
    if (ticket) {
      const [created] = await prisma.$transaction([
        prisma.message.create({ data: { ...message, ticketId: ticket.id }, select: { id: true } }),
        // A student replying to a resolved ticket reopens it. Also bumps updatedAt.
        prisma.ticket.update({
          where: { id: ticket.id },
          data: { status: ticket.status === 'resolved' ? 'open' : ticket.status },
        }),
      ])
      return { result: 'appended', ticketId: ticket.id, messageId: created.id }
    }

    const created = await prisma.ticket.create({
      data: {
        subject: email.subject,
        requesterEmail: email.from.email,
        requesterName: email.from.name,
        messages: { create: message },
      },
      select: { id: true, messages: { select: { id: true } } },
    })
    return { result: 'created', ticketId: created.id, messageId: created.messages[0]?.id }
  } catch (err) {
    // The same email delivered twice at once: the second insert hits the
    // unique Message-ID, so report it as a duplicate.
    if (isUniqueViolation(err)) {
      const raced = await findMessage(email.messageId)
      if (raced) return { result: 'duplicate', ticketId: raced.ticketId, messageId: raced.id }
    }
    throw err
  }
}

function findMessage(emailMessageId: string) {
  return prisma.message.findUnique({ where: { emailMessageId }, select: { id: true, ticketId: true } })
}

// The open or resolved ticket this email replies to, matched through the
// Message-IDs in In-Reply-To / References. Only the ticket's requester can add
// to it, and replies to a closed ticket start a new one.
async function findTicketRepliedTo(email: InboundEmail) {
  const ids = [...new Set([email.inReplyTo, ...(email.references ?? [])])].filter(
    (id): id is string => Boolean(id),
  )
  if (ids.length === 0) return null

  const match = await prisma.message.findFirst({
    where: {
      emailMessageId: { in: ids },
      ticket: { requesterEmail: email.from.email, status: { not: 'closed' } },
    },
    orderBy: { createdAt: 'desc' },
    select: { ticket: { select: { id: true, status: true } } },
  })
  return match?.ticket ?? null
}

// Out-of-office replies, bounces and list mail must not open tickets (and,
// once we send replies, must not start mail loops). RFC 3834 plus common
// non-standard headers.
export function isAutoReply(email: { from: { email: string }; headers: Record<string, string> }): boolean {
  const headers = email.headers
  const autoSubmitted = headers['auto-submitted']?.trim().toLowerCase()
  if (autoSubmitted && autoSubmitted !== 'no') return true

  const precedence = headers['precedence']?.trim().toLowerCase()
  if (precedence && ['bulk', 'junk', 'list', 'auto_reply'].includes(precedence)) return true

  if ('x-autoreply' in headers || 'x-autorespond' in headers) return true

  const localPart = email.from.email.split('@')[0]
  return localPart === 'mailer-daemon' || localPart === 'postmaster'
}

function emailBody(email: Pick<InboundEmail, 'text' | 'html'>): string {
  const text = email.text?.trim()
  return text ? text : htmlToText(email.html ?? '')
}

// Plain-text fallback for HTML-only emails. Good enough to read in the app;
// the HTML is never rendered, so this isn't a sanitiser.
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 'P2002'
}
