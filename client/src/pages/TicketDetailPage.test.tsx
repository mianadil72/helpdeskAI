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

// Answers GETs from fixtures and applies PATCHes and replies to the ticket it returns.
function serve(current: TicketDetail = ticket) {
  fetchMock.mockImplementation(async (input, init) => {
    if (String(input) === '/api/tickets/assignees') return json(assignees)
    if (String(input).endsWith('/replies/polish')) {
      const { body } = JSON.parse(String(init!.body)) as { body: string }
      return json({ body: `Polished: ${body.trim()}` })
    }
    if (init?.method === 'POST') {
      const { body, resolve } = JSON.parse(String(init.body)) as { body: string; resolve: boolean }
      const reply = {
        id: `m${current.messages.length + 1}`,
        direction: 'outbound' as const,
        fromEmail: 'me@example.com',
        fromName: 'Me Agent',
        body: body.trim(),
        createdAt: '2026-10-03T12:00:00.000Z',
      }
      current = { ...current, messages: [...current.messages, reply], ...(resolve && { status: 'resolved' as const }) }
      return json({ ticket: current }, 201)
    }
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

  it('sends a reply, shows it in the thread and clears the form', async () => {
    const user = renderPage()
    const reply = await screen.findByRole('textbox', { name: 'Reply' })

    await user.type(reply, 'Try resetting your password.')
    await user.click(screen.getByRole('button', { name: 'Send reply' }))

    const thread = () => within(screen.getByRole('region', { name: 'Messages' })).getAllByRole('article')
    await waitFor(() => expect(thread()).toHaveLength(3))
    expect(
      fetchMock.mock.calls
        .filter(([, init]) => init?.method === 'POST')
        .map(([url, init]) => [String(url), JSON.parse(String(init!.body))]),
    ).toEqual([['/api/tickets/t1/replies', { body: 'Try resetting your password.', resolve: false }]])
    const messages = thread()
    expect(messages[2]).toHaveAccessibleName('Message from Me Agent')
    expect(messages[2]).toHaveTextContent('Try resetting your password.')
    await waitFor(() => expect(reply).toHaveValue(''))
  })

  it('sends a reply and resolves the ticket', async () => {
    const user = renderPage()
    await user.type(await screen.findByRole('textbox', { name: 'Reply' }), 'All fixed now.')
    await user.click(screen.getByRole('button', { name: 'Send & resolve' }))

    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Status' })).toHaveTextContent('Resolved'),
    )
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')
    expect(JSON.parse(String(post![1]!.body))).toEqual({ body: 'All fixed now.', resolve: true })
    // Already resolved now, so only the plain reply button is left.
    expect(screen.queryByRole('button', { name: 'Send & resolve' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Send reply' })).toBeInTheDocument()
  })

  it('does not send an empty reply', async () => {
    const user = renderPage()
    await user.type(await screen.findByRole('textbox', { name: 'Reply' }), '   ')
    await user.click(screen.getByRole('button', { name: 'Send reply' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Write a reply')
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false)
  })

  it('shows an error when the reply fails', async () => {
    const user = renderPage()
    await user.type(await screen.findByRole('textbox', { name: 'Reply' }), 'Hello')
    fetchMock.mockImplementation(async () => json({ error: 'Ticket is closed; reopen it to reply' }, 409))

    await user.click(screen.getByRole('button', { name: 'Send reply' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not send: Ticket is closed; reopen it to reply',
    )
    expect(screen.getByRole('textbox', { name: 'Reply' })).toHaveValue('Hello')
  })

  it('polishes the draft, can undo it, and sends the polished text', async () => {
    const user = renderPage()
    const reply = await screen.findByRole('textbox', { name: 'Reply' })
    await user.type(reply, 'try reset pw')

    await user.click(screen.getByRole('button', { name: 'Polish' }))
    await waitFor(() => expect(reply).toHaveValue('Polished: try reset pw'))
    expect(fetchMock.mock.calls.find(([url]) => String(url).endsWith('/polish'))?.[0]).toBe(
      '/api/tickets/t1/replies/polish',
    )

    await user.click(screen.getByRole('button', { name: 'Undo polish' }))
    expect(reply).toHaveValue('try reset pw')
    expect(screen.queryByRole('button', { name: 'Undo polish' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Polish' }))
    await waitFor(() => expect(reply).toHaveValue('Polished: try reset pw'))
    await user.click(screen.getByRole('button', { name: 'Send reply' }))

    await waitFor(() => expect(reply).toHaveValue(''))
    const sent = fetchMock.mock.calls.find(([url]) => String(url) === '/api/tickets/t1/replies')
    expect(JSON.parse(String(sent![1]!.body))).toEqual({ body: 'Polished: try reset pw', resolve: false })
    expect(screen.queryByRole('button', { name: 'Undo polish' })).not.toBeInTheDocument()
  })

  it('drops Undo once the polished text is edited', async () => {
    const user = renderPage()
    const reply = await screen.findByRole('textbox', { name: 'Reply' })
    await user.type(reply, 'hi')
    await user.click(screen.getByRole('button', { name: 'Polish' }))
    await screen.findByRole('button', { name: 'Undo polish' })

    await user.type(reply, '!')

    expect(screen.queryByRole('button', { name: 'Undo polish' })).not.toBeInTheDocument()
  })

  it('puts Polish before the send buttons', async () => {
    renderPage()
    await screen.findByRole('textbox', { name: 'Reply' })

    const form = screen.getByRole('textbox', { name: 'Reply' }).closest('form')!
    const names = within(form)
      .getAllByRole('button')
      .map((button) => button.textContent)
    expect(names).toEqual(['Polish', 'Send & resolve', 'Send reply'])
  })

  it('disables the buttons while polishing', async () => {
    const user = renderPage()
    await user.type(await screen.findByRole('textbox', { name: 'Reply' }), 'hi')
    let respond!: (response: Response) => void
    fetchMock.mockImplementation(() => new Promise<Response>((resolve) => (respond = resolve)))

    await user.click(screen.getByRole('button', { name: 'Polish' }))

    expect(await screen.findByRole('button', { name: 'Polishing…' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Send reply' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Send & resolve' })).toBeDisabled()

    respond(json({ body: 'Hi there.' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send reply' })).toBeEnabled())
    expect(screen.getByRole('textbox', { name: 'Reply' })).toHaveValue('Hi there.')
  })

  it('sends the polished text with Send & resolve', async () => {
    const user = renderPage()
    const reply = await screen.findByRole('textbox', { name: 'Reply' })
    await user.type(reply, 'all fixed')
    await user.click(screen.getByRole('button', { name: 'Polish' }))
    await waitFor(() => expect(reply).toHaveValue('Polished: all fixed'))

    await user.click(screen.getByRole('button', { name: 'Send & resolve' }))

    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Status' })).toHaveTextContent('Resolved'))
    const sent = fetchMock.mock.calls.find(([url]) => String(url) === '/api/tickets/t1/replies')
    expect(JSON.parse(String(sent![1]!.body))).toEqual({ body: 'Polished: all fixed', resolve: true })
  })

  it('clears a polish error after a successful polish', async () => {
    const user = renderPage()
    await user.type(await screen.findByRole('textbox', { name: 'Reply' }), 'Hello')
    fetchMock.mockImplementationOnce(async () =>
      json({ error: 'The AI provider account is out of credits. Ask an admin to add credits.' }, 502),
    )

    await user.click(screen.getByRole('button', { name: 'Polish' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not polish: The AI provider account is out of credits. Ask an admin to add credits.',
    )

    await user.click(screen.getByRole('button', { name: 'Polish' }))
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Reply' })).toHaveValue('Polished: Hello'))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('does not polish an empty draft', async () => {
    const user = renderPage()
    await screen.findByRole('textbox', { name: 'Reply' })
    await user.click(screen.getByRole('button', { name: 'Polish' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Write a reply')
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/polish'))).toBe(false)
  })

  it('keeps the draft and shows an error when polishing fails', async () => {
    const user = renderPage()
    await user.type(await screen.findByRole('textbox', { name: 'Reply' }), 'Hello')
    fetchMock.mockImplementation(async () => json({ error: 'AI polishing is not configured' }, 503))

    await user.click(screen.getByRole('button', { name: 'Polish' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not polish: AI polishing is not configured')
    expect(screen.getByRole('textbox', { name: 'Reply' })).toHaveValue('Hello')
    expect(screen.getByRole('button', { name: 'Send reply' })).toBeEnabled()
  })

  it('hides the reply form on a closed ticket', async () => {
    serve({ ...ticket, status: 'closed' })
    renderPage()

    expect(await screen.findByText('This ticket is closed. Reopen it to reply.')).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'Reply' })).not.toBeInTheDocument()
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
