import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CreateUserDialog } from './CreateUserDialog'

const fetchMock = vi.fn<typeof fetch>()

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  fetchMock.mockReset()
})

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function renderDialog() {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')
  const user = userEvent.setup()
  render(
    <QueryClientProvider client={queryClient}>
      <CreateUserDialog />
    </QueryClientProvider>,
  )
  return { user, invalidateQueries }
}

async function openDialog(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'New user' }))
  return screen.findByRole('dialog', { name: 'Create user' })
}

async function fillForm(
  user: ReturnType<typeof userEvent.setup>,
  dialog: HTMLElement,
  values: { name?: string; email?: string; password?: string },
) {
  const d = within(dialog)
  if (values.name) await user.type(d.getByLabelText('Name'), values.name)
  if (values.email) await user.type(d.getByLabelText('Email'), values.email)
  if (values.password) await user.type(d.getByLabelText('Password'), values.password)
}

const valid = { name: 'Jane Doe', email: 'Jane@Example.com', password: 'password123' }

describe('CreateUserDialog', () => {
  it('opens a modal with name, email and password fields', async () => {
    const { user } = renderDialog()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    const dialog = await openDialog(user)

    const d = within(dialog)
    expect(d.getByLabelText('Name')).toHaveAttribute('type', 'text')
    expect(d.getByLabelText('Email')).toHaveAttribute('type', 'email')
    expect(d.getByLabelText('Password')).toHaveAttribute('type', 'password')
  })

  it('shows an error under each field and does not submit an empty form', async () => {
    const { user } = renderDialog()
    const dialog = await openDialog(user)

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
    const dialog = await openDialog(user)

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
    const dialog = await openDialog(user)

    await user.click(within(dialog).getByLabelText('Name'))
    await user.tab()

    expect(await within(dialog).findByText('Name is required')).toBeInTheDocument()
  })

  it('creates the user, closes the modal and refreshes the user list', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        {
          user: {
            id: '1',
            name: 'Jane Doe',
            email: 'jane@example.com',
            role: 'agent',
            createdAt: new Date().toISOString(),
          },
        },
        201,
      ),
    )
    const { user, invalidateQueries } = renderDialog()
    const dialog = await openDialog(user)

    await fillForm(user, dialog, valid)
    await user.click(within(dialog).getByRole('button', { name: 'Create user' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(fetchMock).toHaveBeenCalledWith('/api/users', expect.objectContaining({ method: 'POST' }))
    // The form sends the normalised values from the shared schema.
    const body = JSON.parse(fetchMock.mock.calls[0][1]!.body as string)
    expect(body).toEqual({ name: 'Jane Doe', email: 'jane@example.com', password: 'password123' })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['users'] })
  })

  it('shows a duplicate-email error under the email field and stays open', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: 'A user with this email already exists' }, 409))
    const { user } = renderDialog()
    const dialog = await openDialog(user)

    await fillForm(user, dialog, valid)
    await user.click(within(dialog).getByRole('button', { name: 'Create user' }))

    const d = within(dialog)
    expect(await d.findByText('A user with this email already exists')).toHaveAttribute('id', 'new-user-email-error')
    expect(d.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('shows other server errors at the top of the form', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: 'Internal server error' }, 500))
    const { user } = renderDialog()
    const dialog = await openDialog(user)

    await fillForm(user, dialog, valid)
    await user.click(within(dialog).getByRole('button', { name: 'Create user' }))

    expect(await within(dialog).findByText('Internal server error')).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('disables the submit button while the request is in flight', async () => {
    let respond!: (res: Response) => void
    fetchMock.mockReturnValue(new Promise((resolve) => (respond = resolve)))
    const { user } = renderDialog()
    const dialog = await openDialog(user)

    await fillForm(user, dialog, valid)
    await user.click(within(dialog).getByRole('button', { name: 'Create user' }))

    expect(await within(dialog).findByRole('button', { name: /Creating/ })).toBeDisabled()
    respond(jsonResponse({ error: 'Internal server error' }, 500))
    expect(await within(dialog).findByRole('button', { name: 'Create user' })).toBeEnabled()
  })

  it('clears the form and errors when cancelled and reopened', async () => {
    const { user } = renderDialog()
    let dialog = await openDialog(user)

    await fillForm(user, dialog, { name: 'Jane' })
    await user.click(within(dialog).getByRole('button', { name: 'Create user' }))
    expect(await within(dialog).findByText('Email is required')).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    dialog = await openDialog(user)
    expect(within(dialog).getByLabelText('Name')).toHaveValue('')
    expect(within(dialog).queryByText('Email is required')).not.toBeInTheDocument()
  })
})
