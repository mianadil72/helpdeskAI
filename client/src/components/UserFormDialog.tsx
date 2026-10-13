import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { CircleAlert, LoaderCircle, UserPlus } from 'lucide-react'
import {
  createUserSchema,
  type CreateUserInput,
  type CreateUserResponse,
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
import { ApiError, apiPost } from '@/lib/api'

const fields = [
  { name: 'name', label: 'Name', type: 'text', autoComplete: 'off', placeholder: 'Jane Doe' },
  { name: 'email', label: 'Email', type: 'email', autoComplete: 'off', placeholder: 'jane@example.com' },
  { name: 'password', label: 'Password', type: 'password', autoComplete: 'new-password', placeholder: 'At least 8 characters' },
] as const

// "New user" button plus the modal form that creates an agent.
export function CreateUserDialog() {
  const [open, setOpen] = useState(false)
  const queryClient = useQueryClient()
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<CreateUserInput>({
    resolver: zodResolver(createUserSchema),
    mode: 'onTouched',
    defaultValues: { name: '', email: '', password: '' },
  })

  const createUser = useMutation({
    mutationFn: (values: CreateUserInput) => apiPost<CreateUserResponse>('/api/users', values),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['users'] }),
  })

  function onOpenChange(next: boolean) {
    setOpen(next)
    if (!next) reset()
  }

  async function onSubmit(values: CreateUserInput) {
    try {
      await createUser.mutateAsync(values)
      onOpenChange(false)
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setError('email', { message: err.message })
      } else {
        setError('root.serverError', {
          message: err instanceof Error ? err.message : 'Could not create user',
        })
      }
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button>
          <UserPlus />
          New user
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create user</DialogTitle>
          <DialogDescription>Add a new agent. They can sign in with this email and password.</DialogDescription>
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
            const id = `new-user-${field.name}`
            const error = errors[field.name]
            return (
              <div key={field.name} className="flex flex-col gap-2">
                <Label htmlFor={id}>{field.label}</Label>
                <Input
                  id={id}
                  type={field.type}
                  autoComplete={field.autoComplete}
                  placeholder={field.placeholder}
                  aria-invalid={error ? 'true' : 'false'}
                  aria-describedby={error ? `${id}-error` : undefined}
                  {...register(field.name)}
                />
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
                  Creating…
                </>
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
