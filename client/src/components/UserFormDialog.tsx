import { useState } from 'react'
import { useForm, type Resolver } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { CircleAlert, LoaderCircle, Pencil, UserPlus } from 'lucide-react'
import {
  createUserSchema,
  updateUserSchema,
  type CreateUserResponse,
  type UpdateUserResponse,
  type UserListItem,
} from '@helpdesk/shared'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ApiError, apiPatch, apiPost } from '@/lib/api'
import { authClient } from '@/lib/auth-client'

// What the form holds. On submit the shared schemas trim and lowercase it and,
// when editing, turn a blank password into "keep the current one".
interface UserFormValues {
  name: string
  email: string
  password: string
}

interface UserFormOutput {
  name: string
  email: string
  password?: string
}

interface UserFormDialogProps {
  // Omit to create a new agent; pass a user to edit them.
  user?: UserListItem
}

// Create mode: a "New user" button and a modal that creates an agent.
// Edit mode: a pencil icon button and the same form, filled with the user's data.
export function UserFormDialog({ user }: UserFormDialogProps) {
  const isEdit = user !== undefined
  const initialValues: UserFormValues = { name: user?.name ?? '', email: user?.email ?? '', password: '' }

  const [open, setOpen] = useState(false)
  const queryClient = useQueryClient()
  const { data: session, refetch: refetchSession } = authClient.useSession()
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<UserFormValues, unknown, UserFormOutput>({
    resolver: zodResolver(isEdit ? updateUserSchema : createUserSchema) as Resolver<
      UserFormValues,
      unknown,
      UserFormOutput
    >,
    mode: 'onTouched',
    defaultValues: initialValues,
  })

  const saveUser = useMutation({
    mutationFn: (values: UserFormOutput) =>
      isEdit
        ? apiPatch<UpdateUserResponse>(`/api/users/${encodeURIComponent(user.id)}`, values)
        : apiPost<CreateUserResponse>('/api/users', values),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['users'] })
      // The header shows the signed-in user's name, which an admin may have just edited.
      if (isEdit && session?.user.id === user.id) await refetchSession()
    },
  })

  function onOpenChange(next: boolean) {
    setOpen(next)
    // Start from the latest data each time, and drop errors from last time.
    reset(initialValues)
  }

  async function onSubmit(values: UserFormOutput) {
    try {
      await saveUser.mutateAsync(values)
      onOpenChange(false)
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setError('email', { message: err.message })
      } else {
        setError('root.serverError', {
          message: err instanceof Error ? err.message : 'Could not save user',
        })
      }
    }
  }

  const fields = [
    { name: 'name', label: 'Name', type: 'text', autoComplete: 'off', placeholder: 'Jane Doe' },
    { name: 'email', label: 'Email', type: 'email', autoComplete: 'off', placeholder: 'jane@example.com' },
    {
      name: 'password',
      label: 'Password',
      type: 'password',
      autoComplete: 'new-password',
      placeholder: isEdit ? 'Leave blank to keep current' : 'At least 8 characters',
      hint: isEdit ? 'Leave blank to keep the current password.' : undefined,
    },
  ] as const

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        {isEdit ? (
          <Button variant="ghost" size="icon-sm" aria-label={`Edit ${user.email}`} title="Edit user">
            <Pencil />
          </Button>
        ) : (
          <Button>
            <UserPlus />
            New user
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit user' : 'Create user'}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? `Update ${user.name}'s details.`
              : 'Add a new agent. They can sign in with this email and password.'}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-4">
          {errors.root?.serverError && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              <CircleAlert className="mt-0.5 size-4 shrink-0" />
              <span>{errors.root.serverError.message}</span>
            </div>
          )}

          {fields.map((field) => {
            const id = `user-form-${field.name}`
            const error = errors[field.name]
            const hint = 'hint' in field ? field.hint : undefined
            const describedBy = [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(' ')
            return (
              <div key={field.name} className="flex flex-col gap-2">
                <Label htmlFor={id}>{field.label}</Label>
                <Input
                  id={id}
                  type={field.type}
                  autoComplete={field.autoComplete}
                  placeholder={field.placeholder}
                  aria-invalid={error ? 'true' : 'false'}
                  aria-describedby={describedBy || undefined}
                  {...register(field.name)}
                />
                {hint && (
                  <p id={`${id}-hint`} className="text-sm text-muted-foreground">
                    {hint}
                  </p>
                )}
                {error && (
                  <p id={`${id}-error`} role="alert" className="text-sm text-destructive">
                    {error.message}
                  </p>
                )}
              </div>
            )
          })}

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? (
                <>
                  <LoaderCircle className="animate-spin" />
                  {isEdit ? 'Saving…' : 'Creating…'}
                </>
              ) : isEdit ? (
                'Save changes'
              ) : (
                'Create user'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
