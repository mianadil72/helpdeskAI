import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import type { AssigneesResponse, TicketDetail } from '@helpdesk/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TicketDetailPage } from './TicketDetailPage'

vi.mock('@/lib/auth-client', () => ({
  authClient: { useSession: () => ({ data: { user: { id: 'me-id' } } }) },
}))

const fetchMock = vi.fn<typeof fetch>()

const ticket: TicketDetail = {
  id: 't1',
  subject: "Can't log in",
  requesterEmail: 'stu@example.com',
  requesterName: 'Stu Dent',
  status: 'open',
  category: 'technical_question',
  assignee: null,
  summary: null,
  createdAt: '2026-10-01T12:00:00.000Z',
  updatedAt: '2026-10-02T12:00:00.000Z',
  messages: [
    {
      id: 'm1',
      direction: 'inbound',
      fromEmail: 'stu@example.com',
      fromName: 'Stu Dent',
      body: 'My password stopped working.\n\nThanks,\nStu',
      createdAt: '2026-10-01T12:00:00.000Z',
    },
    {
      id: 'm2',
      direction: 'inbound',
      fromEmail: 'stu@example.com',
      fromName: null,
      body: '<b>Still</b> broken',
      createdAt: '2026-10-02T12:00:00.000Z',
    },
  ],
}

const assignees: AssigneesResponse = {
  users: [
    { id: 'me-id', name: 'Me Agent', email: 'me@example.com' },
    { id: 'sam-id', name: 'Sam Agent', email: 'sam@example.com' },
  ],
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status })
}

// Answers GETs from fixtures and applies PATCHes to the ticket it returns.
function serve(current: TicketDetail = ticket) {
  fetchMock.mockImplementation(async (input, init) => {
    if (String(input) === '/api/tickets/assignees') return json(assignees)
    if (init?.method === 'PATCH') {
      const { assigneeId, ...rest } = JSON.parse(String(init.body)) as { assigneeId?: string | null }
      current = { ...current, ...rest }
      if (assigneeId !== undefined) {
        const user = assignees.users.find((u) => u.id === assigneeId)
        current = { ...current, assignee: user ? { id: user.id, name: user.name } : null }
      }
    }
    return json({ ticket: current })
  })
}

function patches() {
  return fetchMock.mock.calls
    .filter(([, init]) => init?.method === 'PATCH')
    .map(([url, init]) => [String(url), JSON.parse(String(init!.body))])
}

function renderPage(state?: unknown) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[{ pathname: '/tickets/t1', state }]}>
        <Routes>
          <Route path="/tickets/:id" element={<TicketDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return userEvent.setup()
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  serve()
})

afterEach(() => {
  vi.unstubAllGlobals()
  fetchMock.mockReset()
})

describe('TicketDetailPage', () => {
  it('shows the ticket and its messages in order, as plain text', async () => {
    renderPage()

    expect(await screen.findByRole('heading', { name: "Can't log in" })).toBeInTheDocument()
    expect(screen.getByText(/From Stu Dent <stu@example.com>/)).toBeInTheDocument()

    const messages = within(screen.getByRole('region', { name: 'Messages' })).getAllByRole('article')
    expect(messages).toHaveLength(2)
    expect(messages[0]).toHaveAccessibleName('Message from Stu Dent')
    expect(messages[0]).toHaveTextContent('My password stopped working.')
    expect(messages[1]).toHaveAccessibleName('Message from stu@example.com')
    // HTML in a body is shown, not rendered.
    expect(within(messages[1]).getByText('<b>Still</b> broken')).toBeInTheDocument()
  })

  it('shows the current status, category and assignee', async () => {
    renderPage()

    expect(await screen.findByRole('combobox', { name: 'Status' })).toHaveTextContent('Open')
    expect(screen.getByRole('combobox', { name: 'Category' })).toHaveTextContent('Technical question')
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Assignee' })).toHaveTextContent('Unassigned'),
    )
  })

  it('changes the status', async () => {
    const user = renderPage()

    await user.click(await screen.findByRole('combobox', { name: 'Status' }))
    await user.click(await screen.findByRole('option', { name: 'Resolved' }))

    await waitFor(() => expect(patches()).toEqual([['/api/tickets/t1', { status: 'resolved' }]]))
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Status' })).toHaveTextContent('Resolved'),
    )
  })

  it('changes the category', async () => {
    const user = renderPage()

    await user.click(await screen.findByRole('combobox', { name: 'Category' }))
    await user.click(await screen.findByRole('option', { name: 'Refund request' }))

    await waitFor(() =>
      expect(patches()).toEqual([['/api/tickets/t1', { category: 'refund_request' }]]),
    )
  })

  it('assigns to another user and then unassigns', async () => {
    const user = renderPage()
    const assignee = await screen.findByRole('combobox', { name: 'Assignee' })
    await waitFor(() => expect(assignee).toBeEnabled())

    await user.click(assignee)
    await user.click(await screen.findByRole('option', { name: 'Sam Agent' }))
    await waitFor(() => expect(assignee).toHaveTextContent('Sam Agent'))
    await waitFor(() => expect(assignee).toBeEnabled())

    await user.click(assignee)
    await user.click(await screen.findByRole('option', { name: 'Unassigned' }))

    await waitFor(() =>
      expect(patches()).toEqual([
        ['/api/tickets/t1', { assigneeId: 'sam-id' }],
        ['/api/tickets/t1', { assigneeId: null }],
      ]),
    )
  })

  it('assigns to the signed-in user, then hides the button', async () => {
    const user = renderPage()

    await user.click(await screen.findByRole('button', { name: 'Assign to me' }))

    await waitFor(() => expect(patches()).toEqual([['/api/tickets/t1', { assigneeId: 'me-id' }]]))
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Assign to me' })).not.toBeInTheDocument(),
    )
    expect(screen.getByRole('combobox', { name: 'Assignee' })).toHaveTextContent('Me Agent')
  })

  it('shows an error when saving fails', async () => {
    const user = renderPage()
    await screen.findByRole('button', { name: 'Assign to me' })
    fetchMock.mockImplementation(async () => json({ error: 'Invalid input' }, 400))

    await user.click(screen.getByRole('button', { name: 'Assign to me' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save: Invalid input')
  })

  it('links back to the list with its filters', async () => {
    renderPage({ listSearch: '?status=open&page=2' })

    expect(await screen.findByRole('link', { name: 'Back to tickets' })).toHaveAttribute(
      'href',
      '/tickets?status=open&page=2',
    )
  })

  it('says when the ticket does not exist', async () => {
    fetchMock.mockImplementation(async () => json({ error: 'Ticket not found' }, 404))
    renderPage()

    expect(await screen.findByRole('alert')).toHaveTextContent('Ticket not found.')
  })
})
