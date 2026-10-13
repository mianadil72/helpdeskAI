import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { UserListItem } from '@helpdesk/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DeleteUserButton } from './DeleteUserButton'

vi.mock('@/lib/auth-client', () => ({
  authClient: { useSession: () => ({ data: { user: { id: 'admin-id' } } }) },
}))

const fetchMock = vi.fn<typeof fetch>()

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  fetchMock.mockReset()
})

const agent: UserListItem = {
  id: 'agent-id',
  name: 'Sam Agent',
  email: 'sam@example.com',
  role: 'agent',
  createdAt: '2026-10-01T12:00:00.000Z',
}

function renderButton(user: UserListItem = agent) {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')
  const ue = userEvent.setup()
  render(
    <QueryClientProvider client={queryClient}>
      <DeleteUserButton user={user} />
    </QueryClientProvider>,
  )
  return { user: ue, invalidateQueries }
}

async function openConfirm(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: `Delete ${agent.email}` }))
  return screen.findByRole('alertdialog', { name: 'Delete user?' })
}

describe('DeleteUserButton', () => {
  it('asks for confirmation naming the user, without deleting yet', async () => {
    const { user } = renderButton()

    const dialog = await openConfirm(user)

    expect(dialog).toHaveTextContent('Sam Agent (sam@example.com)')
    expect(dialog).toHaveTextContent("can't be undone")
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does nothing when cancelled', async () => {
    const { user } = renderButton()
    const dialog = await openConfirm(user)

    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('deletes the user, closes and refreshes the list when confirmed', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }))
    const { user, invalidateQueries } = renderButton()
    const dialog = await openConfirm(user)

    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(fetchMock).toHaveBeenCalledWith('/api/users/agent-id', { method: 'DELETE' })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['users'] })
  })

  it('disables both buttons while deleting', async () => {
    let respond!: (res: Response) => void
    fetchMock.mockReturnValue(new Promise((resolve) => (respond = resolve)))
    const { user } = renderButton()
    const dialog = await openConfirm(user)

    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))

    expect(await within(dialog).findByRole('button', { name: /Deleting/ })).toBeDisabled()
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeDisabled()
    respond(new Response(null, { status: 204 }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
  })

  it('keeps the dialog open and shows the error when deleting fails', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: 'User not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    const { user, invalidateQueries } = renderButton()
    const dialog = await openConfirm(user)

    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('User not found')
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    expect(invalidateQueries).not.toHaveBeenCalled()

    // The error is cleared when the dialog is reopened.
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    const reopened = await openConfirm(user)
    expect(within(reopened).queryByRole('alert')).not.toBeInTheDocument()
  })

  it("is disabled on the signed-in admin's own row", async () => {
    const { user } = renderButton({ ...agent, id: 'admin-id', role: 'admin' })

    const button = screen.getByRole('button', { name: `Delete ${agent.email}` })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('title', "You can't delete your own account")
    await user.click(button)
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })
})
