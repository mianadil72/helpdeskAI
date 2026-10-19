import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useEffect } from 'react'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router'
import type { TicketListItem, TicketsResponse } from '@helpdesk/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TicketsPage } from './TicketsPage'

const fetchMock = vi.fn<typeof fetch>()

const ticket: TicketListItem = {
  id: 't1',
  subject: "Can't log in",
  requesterEmail: 'stu@example.com',
  requesterName: 'Stu Dent',
  status: 'open',
  category: 'technical_question',
  assignee: null,
  messageCount: 2,
  createdAt: '2026-10-01T12:00:00.000Z',
  updatedAt: '2026-10-02T12:00:00.000Z',
}

function respond(body: Partial<TicketsResponse> = {}) {
  const full: TicketsResponse = { tickets: [ticket], total: 1, page: 1, pageSize: 20, ...body }
  fetchMock.mockImplementation(async () => new Response(JSON.stringify(full)))
}

// Last requested query string, as an object.
function lastQuery() {
  const url = String(fetchMock.mock.lastCall?.[0])
  return Object.fromEntries(new URL(url, 'http://x').searchParams)
}

let location = ''
function LocationProbe() {
  const { search } = useLocation()
  useEffect(() => {
    location = search
  }, [search])
  return null
}

function renderPage(url = '/tickets') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[url]}>
        <TicketsPage />
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return userEvent.setup()
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  respond()
})

afterEach(() => {
  vi.unstubAllGlobals()
  fetchMock.mockReset()
})

describe('TicketsPage', () => {
  it('lists tickets with their status, category and assignee', async () => {
    renderPage()

    const row = (await screen.findByText("Can't log in")).closest('tr')!
    expect(within(row).getByText('2 messages')).toBeInTheDocument()
    expect(within(row).getByText('Stu Dent')).toBeInTheDocument()
    expect(within(row).getByText('stu@example.com')).toBeInTheDocument()
    expect(within(row).getByText('Open')).toBeInTheDocument()
    expect(within(row).getByText('Technical question')).toBeInTheDocument()
    expect(within(row).getByText('Unassigned')).toBeInTheDocument()
    expect(screen.getByText('1–1 of 1 tickets')).toBeInTheDocument()
    expect(lastQuery()).toEqual({ sort: 'createdAt', order: 'desc', page: '1', pageSize: '20' })
  })

  it('reads filters from the URL', async () => {
    renderPage('/tickets?status=resolved&category=refund_request&q=card&page=2')

    await screen.findByText("Can't log in")
    expect(lastQuery()).toMatchObject({
      status: 'resolved',
      category: 'refund_request',
      q: 'card',
      page: '2',
    })
    expect(screen.getByRole('searchbox', { name: 'Search tickets' })).toHaveValue('card')
    expect(screen.getByRole('combobox', { name: 'Status' })).toHaveTextContent('Resolved')
  })

  it('filters by status and resets to the first page', async () => {
    const user = renderPage('/tickets?page=3')
    await screen.findByText("Can't log in")

    await user.click(screen.getByRole('combobox', { name: 'Status' }))
    await user.click(await screen.findByRole('option', { name: 'Closed' }))

    await waitFor(() => expect(lastQuery()).toMatchObject({ status: 'closed', page: '1' }))
    expect(location).toBe('?status=closed')
  })

  it('searches after typing stops', async () => {
    const user = renderPage()
    await screen.findByText("Can't log in")

    await user.type(screen.getByRole('searchbox', { name: 'Search tickets' }), 'refund')

    await waitFor(() => expect(lastQuery()).toMatchObject({ q: 'refund' }))
    expect(location).toBe('?q=refund')
  })

  it('sorts by a date column when its header is clicked', async () => {
    const user = renderPage()
    await screen.findByText("Can't log in")
    expect(screen.getByRole('columnheader', { name: /Created/ })).toHaveAttribute('aria-sort', 'descending')

    await user.click(screen.getByRole('button', { name: 'Updated' }))
    await waitFor(() => expect(lastQuery()).toMatchObject({ sort: 'updatedAt', order: 'desc' }))

    await user.click(screen.getByRole('button', { name: 'Updated' }))
    await waitFor(() => expect(lastQuery()).toMatchObject({ sort: 'updatedAt', order: 'asc' }))
  })

  it('sorts text columns A to Z first', async () => {
    const user = renderPage()
    await screen.findByText("Can't log in")

    for (const [name, sort] of [
      ['Subject', 'subject'],
      ['Requester', 'requester'],
      ['Status', 'status'],
      ['Category', 'category'],
      ['Assignee', 'assignee'],
    ]) {
      await user.click(screen.getByRole('button', { name }))
      await waitFor(() => expect(lastQuery()).toMatchObject({ sort, order: 'asc' }))
    }
  })

  it('pages through results', async () => {
    respond({ total: 45 })
    const user = renderPage()
    await screen.findByText('1–20 of 45 tickets')
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'Next page' }))

    await waitFor(() => expect(lastQuery()).toMatchObject({ page: '2' }))
    expect(await screen.findByText('Page 2 of 3')).toBeInTheDocument()
  })

  it('says when no tickets match the filters', async () => {
    respond({ tickets: [], total: 0 })
    renderPage('/tickets?status=closed')

    expect(await screen.findByText('No tickets match these filters.')).toBeInTheDocument()
  })

  it('shows an error when loading fails', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }))
    renderPage()

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load tickets: Unauthorized')
  })
})
