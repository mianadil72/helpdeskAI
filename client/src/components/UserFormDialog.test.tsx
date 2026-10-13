import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { UserListItem } from '@helpdesk/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { UserFormDialog } from './UserFormDialog'

const session = vi.hoisted(() => ({ userId: 'admin-id', refetch: vi.fn() }))

vi.mock('@/lib/auth-client', () => ({
  authClient: {
    useSession: () => ({ data: { user: { id: session.userId } }, refetch: session.refetch }),
  },
}))

const fetchMock = vi.fn<typeof fetch>()

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  fetchMock.mockReset()
  session.refetch.mockReset()
})

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function renderDialog(user?: UserListItem) {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')
  const userEv = userEvent.setup()
  render(
    <QueryClientProvider client={queryClient}>
      <UserFormDialog user={user} />
    </QueryClientProvider>,
  )
  return { user: userEv, invalidateQueries }
}

type User = ReturnType<typeof userEvent.setup>

async function openCreate(user: User) {
  await user.click(screen.getByRole('button', { name: 'New user' }))
  return screen.findByRole('dialog', { name: 'Create user' })
}

async function openEdit(user: User, email: string) {
  await user.click(screen.getByRole('button', { name: `Edit ${email}` }))
  return screen.findByRole('dialog', { name: 'Edit user' })
}

async function fillForm(user: User, dialog: HTMLElement, values: { name?: string; email?: string; password?: string }) {
  const d = within(dialog)
  for (const [label, value] of [
    ['Name', values.name],
    ['Email', values.email],
    ['Password', values.password],
  ] as const) {
    if (value === undefined) continue
    await user.clear(d.getByLabelText(label))
    if (value) await user.type(d.getByLabelText(label), value)
  }
}

function sentBody(call = 0) {
  return JSON.parse(fetchMock.mock.calls[call][1]!.body as string)
}

const valid = { name: 'Jane Doe', email: 'Jane@Example.com', password: 'password123' }

const agent: UserListItem = {
  id: 'agent-id',
  name: 'Sam Agent',
  email: 'sam@example.com',
  role: 'agent',
  createdAt: '2026-10-01T12:00:00.000Z',
}

describe('UserFormDialog (create)', () => {
  it('opens a modal with name, email and password fields', async () => {
    const { user } = renderDialog()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    const dialog = await openCreate(user)

    const d = within(dialog)
    expect(d.getByLabelText('Name')).toHaveAttribute('type', 'text')
    expect(d.getByLabelText('Email')).toHaveAttribute('type', 'email')
    expect(d.getByLabelText('Password')).toHaveAttribute('type', 'password')
  })

  it('shows an error under each field and does not submit an empty form', async () => {
    const { user } = renderDialog()
    const dialog = await openCreate(user)

    await user.click(within(dialog).getByRole('button', { name: 'Create user' }))

    const d = within(dialog)
    expect(await d.findByText('Name is required')).toHaveAttribute('role', 'alert')
    expect(d.getByText('Email is required')).toBeInTheDocument()
    expect(d.getByText('Password must be at least 8 characters')).toBeInTheDocument()
    expect(d.getByLabelText('Name')).toHaveAttribute('aria-invalid', 'true')
    expect(d.getByLabelText('Name')).toHaveAccessibleDescription('Name is required')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('validates the email format and password length', async () => {
    const { user } = renderDialog()
    const dialog = await openCreate(user)

    await fillForm(user, dialog, { name: 'Jane', email: 'not-an-email', password: 'short' })
    await user.click(within(dialog).getByRole('button', { name: 'Create user' }))

    const d = within(dialog)
    expect(await d.findByText('Enter a valid email address')).toBeInTheDocument()
    expect(d.getByText('Password must be at least 8 characters')).toBeInTheDocument()
    expect(d.queryByText('Name is required')).not.toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('shows a field error when a field is left after being touched', async () => {
    const { user } = renderDialog()
    const dialog = await openCreate(user)

    await user.click(within(dialog).getByLabelText('Name'))
    await user.tab()

    expect(await within(dialog).findByText('Name is required')).toBeInTheDocument()
  })

  it('creates the user, closes the modal and refreshes the user list', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ user: { ...agent, id: '1' } }, 201))
    const { user, invalidateQueries } = renderDialog()
    const dialog = await openCreate(user)

    await fillForm(user, dialog, valid)
    await user.click(within(dialog).getByRole('button', { name: 'Create user' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(fetchMock).toHaveBeenCalledWith('/api/users', expect.objectContaining({ method: 'POST' }))
    // The form sends the normalised values from the shared schema.
    expect(sentBody()).toEqual({ name: 'Jane Doe', email: 'jane@example.com', password: 'password123' })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['users'] })
  })

  it('shows a duplicate-email error under the email field and stays open', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: 'A user with this email already exists' }, 409))
    const { user } = renderDialog()
    const dialog = await openCreate(user)

    await fillForm(user, dialog, valid)
    await user.click(within(dialog).getByRole('button', { name: 'Create user' }))

    const d = within(dialog)
    expect(await d.findByText('A user with this email already exists')).toHaveAttribute('id', 'user-form-email-error')
    expect(d.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('shows other server errors at the top of the form', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: 'Internal server error' }, 500))
    const { user } = renderDialog()
    const dialog = await openCreate(user)

    await fillForm(user, dialog, valid)
    await user.click(within(dialog).getByRole('button', { name: 'Create user' }))

    expect(await within(dialog).findByText('Internal server error')).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('disables the submit button while the request is in flight', async () => {
    let respond!: (res: Response) => void
    fetchMock.mockReturnValue(new Promise((resolve) => (respond = resolve)))
    const { user } = renderDialog()
    const dialog = await openCreate(user)

    await fillForm(user, dialog, valid)
    await user.click(within(dialog).getByRole('button', { name: 'Create user' }))

    expect(await within(dialog).findByRole('button', { name: /Creating/ })).toBeDisabled()
    respond(jsonResponse({ error: 'Internal server error' }, 500))
    expect(await within(dialog).findByRole('button', { name: 'Create user' })).toBeEnabled()
  })

  it('clears the form and errors when cancelled and reopened', async () => {
    const { user } = renderDialog()
    let dialog = await openCreate(user)

    await fillForm(user, dialog, { name: 'Jane' })
    await user.click(within(dialog).getByRole('button', { name: 'Create user' }))
    expect(await within(dialog).findByText('Email is required')).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    dialog = await openCreate(user)
    expect(within(dialog).getByLabelText('Name')).toHaveValue('')
    expect(within(dialog).queryByText('Email is required')).not.toBeInTheDocument()
  })
})

describe('UserFormDialog (edit)', () => {
  it('shows an edit icon button that opens the form filled with the user', async () => {
    const { user } = renderDialog(agent)
    expect(screen.queryByRole('button', { name: 'New user' })).not.toBeInTheDocument()

    const dialog = await openEdit(user, agent.email)

    const d = within(dialog)
    expect(d.getByLabelText('Name')).toHaveValue('Sam Agent')
    expect(d.getByLabelText('Email')).toHaveValue('sam@example.com')
    expect(d.getByLabelText('Password')).toHaveValue('')
    expect(d.getByLabelText('Password')).toHaveAccessibleDescription('Leave blank to keep the current password.')
    expect(d.getByRole('button', { name: 'Save changes' })).toBeInTheDocument()
  })

  it('saves changes without a password when it is left blank', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ user: { ...agent, name: 'Sam Renamed' } }))
    const { user, invalidateQueries } = renderDialog(agent)
    const dialog = await openEdit(user, agent.email)

    await fillForm(user, dialog, { name: 'Sam Renamed' })
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(fetchMock).toHaveBeenCalledWith('/api/users/agent-id', expect.objectContaining({ method: 'PATCH' }))
    expect(sentBody()).toEqual({ name: 'Sam Renamed', email: 'sam@example.com' })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['users'] })
    // Someone else was edited, so the signed-in session is left alone.
    expect(session.refetch).not.toHaveBeenCalled()
  })

  it('sends a new password when one is entered', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ user: agent }))
    const { user } = renderDialog(agent)
    const dialog = await openEdit(user, agent.email)

    await fillForm(user, dialog, { password: 'new-password-1' })
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(sentBody()).toEqual({ name: 'Sam Agent', email: 'sam@example.com', password: 'new-password-1' })
  })

  it('validates the edited fields, including a too-short new password', async () => {
    const { user } = renderDialog(agent)
    const dialog = await openEdit(user, agent.email)

    await fillForm(user, dialog, { name: '', email: 'nope', password: 'short' })
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))

    const d = within(dialog)
    expect(await d.findByText('Name is required')).toBeInTheDocument()
    expect(d.getByText('Enter a valid email address')).toBeInTheDocument()
    expect(d.getByText('Password must be at least 8 characters')).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('shows a duplicate-email error under the email field', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: 'A user with this email already exists' }, 409))
    const { user } = renderDialog(agent)
    const dialog = await openEdit(user, agent.email)

    await fillForm(user, dialog, { email: 'taken@example.com' })
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))

    expect(await within(dialog).findByText('A user with this email already exists')).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('discards unsaved edits when cancelled and reopened', async () => {
    const { user } = renderDialog(agent)
    let dialog = await openEdit(user, agent.email)

    await fillForm(user, dialog, { name: 'Unsaved' })
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    dialog = await openEdit(user, agent.email)
    expect(within(dialog).getByLabelText('Name')).toHaveValue('Sam Agent')
  })

  it('refreshes the session when admins edit themselves', async () => {
    const self: UserListItem = { ...agent, id: session.userId, role: 'admin' }
    fetchMock.mockResolvedValue(jsonResponse({ user: { ...self, name: 'New Me' } }))
    const { user } = renderDialog(self)
    const dialog = await openEdit(user, self.email)

    await fillForm(user, dialog, { name: 'New Me' })
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(session.refetch).toHaveBeenCalled())
  })
})
