import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useLocation, useParams } from 'react-router'
import { ArrowLeft, CircleAlert, Mail, MessageSquareReply } from 'lucide-react'
import {
  TICKET_CATEGORIES,
  TICKET_STATUSES,
  type AssigneesResponse,
  type TicketCategory,
  type TicketDetail,
  type TicketMessage,
  type TicketResponse,
  type TicketStatus,
  type UpdateTicketInput,
} from '@helpdesk/shared'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ApiError, apiGet, apiPatch } from '@/lib/api'
import { authClient } from '@/lib/auth-client'
import { ticketCategoryLabels, ticketStatusBadge, ticketStatusLabels } from '@/lib/tickets'

const dateTime = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })
const UNASSIGNED = 'unassigned' // Radix Select can't use '' as an item value.

export function TicketDetailPage() {
  const { id = '' } = useParams()
  // Set by the list's links, so "Back" returns to the same filters and page.
  const listSearch = (useLocation().state as { listSearch?: string } | null)?.listSearch ?? ''

  const { data, isPending, error } = useQuery({
    queryKey: ['ticket', id],
    queryFn: () => apiGet<TicketResponse>(`/api/tickets/${encodeURIComponent(id)}`),
  })

  return (
    <div className="flex flex-col gap-4">
      <Button variant="ghost" size="sm" className="-ml-2.5 self-start" asChild>
        <Link to={`/tickets${listSearch}`}>
          <ArrowLeft />
          Back to tickets
        </Link>
      </Button>

      {isPending && <p className="text-sm text-muted-foreground">Loading ticket…</p>}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error instanceof ApiError && error.status === 404
            ? 'Ticket not found.'
            : `Could not load the ticket: ${error.message}`}
        </p>
      )}
      {data && <TicketView ticket={data.ticket} />}
    </div>
  )
}

function TicketView({ ticket }: { ticket: TicketDetail }) {
  return (
    <>
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold">{ticket.subject}</h1>
          <Badge variant={ticketStatusBadge[ticket.status]}>{ticketStatusLabels[ticket.status]}</Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          From {ticket.requesterName ? `${ticket.requesterName} <${ticket.requesterEmail}>` : ticket.requesterEmail}
          {' · '}opened {dateTime.format(new Date(ticket.createdAt))}
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-[1fr_16rem] md:items-start">
        <section aria-label="Messages" className="flex min-w-0 flex-col gap-3">
          {ticket.summary && (
            <Card size="sm">
              <CardHeader>
                <CardTitle>Summary</CardTitle>
              </CardHeader>
              <CardContent className="text-sm">{ticket.summary}</CardContent>
            </Card>
          )}
          {ticket.messages.map((message) => (
            <MessageCard key={message.id} message={message} />
          ))}
        </section>
        <TicketControls ticket={ticket} />
      </div>
    </>
  )
}

function MessageCard({ message }: { message: TicketMessage }) {
  const inbound = message.direction === 'inbound'
  const Icon = inbound ? Mail : MessageSquareReply
  return (
    <article aria-label={`Message from ${message.fromName ?? message.fromEmail}`}>
      <Card size="sm" className={inbound ? undefined : 'bg-muted/50'}>
        <CardHeader>
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <CardTitle className="flex items-center gap-2">
              <Icon className="size-4 text-muted-foreground" />
              {message.fromName ?? message.fromEmail}
              {message.fromName && (
                <span className="text-xs font-normal text-muted-foreground">{message.fromEmail}</span>
              )}
              {!inbound && <Badge variant="outline">Reply</Badge>}
            </CardTitle>
            <time dateTime={message.createdAt} className="text-xs text-muted-foreground">
              {dateTime.format(new Date(message.createdAt))}
            </time>
          </div>
        </CardHeader>
        {/* Plain text, rendered as text (never as HTML). */}
        <CardContent className="text-sm break-words whitespace-pre-wrap">{message.body}</CardContent>
      </Card>
    </article>
  )
}

// Status, category and assignee. Each change saves straight away.
function TicketControls({ ticket }: { ticket: TicketDetail }) {
  const queryClient = useQueryClient()
  const { data: session } = authClient.useSession()
  const me = session?.user.id

  const assignees = useQuery({
    queryKey: ['assignees'],
    queryFn: () => apiGet<AssigneesResponse>('/api/tickets/assignees'),
  })

  const update = useMutation({
    mutationFn: (body: UpdateTicketInput) =>
      apiPatch<TicketResponse>(`/api/tickets/${encodeURIComponent(ticket.id)}`, body),
    onSuccess: async (data) => {
      queryClient.setQueryData(['ticket', ticket.id], data)
      await queryClient.invalidateQueries({ queryKey: ['tickets'] })
    },
  })

  // A deleted user can still be the assignee; keep them selectable as-is.
  const options = assignees.data?.users ?? []
  const assigneeOptions =
    ticket.assignee && !options.some((user) => user.id === ticket.assignee?.id)
      ? [...options, { ...ticket.assignee, email: '' }]
      : options

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>Details</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="ticket-status">Status</Label>
          <Select
            value={ticket.status}
            disabled={update.isPending}
            onValueChange={(status) => update.mutate({ status: status as TicketStatus })}
          >
            <SelectTrigger id="ticket-status" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TICKET_STATUSES.map((status) => (
                <SelectItem key={status} value={status}>
                  {ticketStatusLabels[status]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="ticket-category">Category</Label>
          <Select
            value={ticket.category}
            disabled={update.isPending}
            onValueChange={(category) => update.mutate({ category: category as TicketCategory })}
          >
            <SelectTrigger id="ticket-category" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TICKET_CATEGORIES.map((category) => (
                <SelectItem key={category} value={category}>
                  {ticketCategoryLabels[category]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="ticket-assignee">Assignee</Label>
          <Select
            value={ticket.assignee?.id ?? UNASSIGNED}
            disabled={update.isPending || assignees.isPending}
            onValueChange={(value) => update.mutate({ assigneeId: value === UNASSIGNED ? null : value })}
          >
            <SelectTrigger id="ticket-assignee" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
              {assigneeOptions.map((user) => (
                <SelectItem key={user.id} value={user.id}>
                  {user.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {me && ticket.assignee?.id !== me && (
            <Button
              variant="outline"
              size="sm"
              disabled={update.isPending}
              onClick={() => update.mutate({ assigneeId: me })}
            >
              Assign to me
            </Button>
          )}
          {assignees.error && (
            <p className="text-xs text-destructive">Could not load users: {assignees.error.message}</p>
          )}
        </div>

        {update.error && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            <CircleAlert className="mt-0.5 size-4 shrink-0" />
            <span>Could not save: {update.error.message}</span>
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          Last updated {dateTime.format(new Date(ticket.updatedAt))}
        </p>
      </CardContent>
    </Card>
  )
}
