import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { CircleAlert, LoaderCircle, Trash2 } from 'lucide-react'
import type { UserListItem } from '@helpdesk/shared'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { apiDelete } from '@/lib/api'
import { authClient } from '@/lib/auth-client'

// Trash icon button in a user's row, with a confirmation before deleting.
// Disabled on the signed-in admin's own row (the server refuses that too).
export function DeleteUserButton({ user }: { user: UserListItem }) {
  const [open, setOpen] = useState(false)
  const queryClient = useQueryClient()
  const { data: session } = authClient.useSession()
  const isSelf = session?.user.id === user.id

  const deleteUser = useMutation({
    mutationFn: () => apiDelete(`/api/users/${encodeURIComponent(user.id)}`),
    onSuccess: async () => {
      setOpen(false)
      await queryClient.invalidateQueries({ queryKey: ['users'] })
    },
  })

  function onOpenChange(next: boolean) {
    // Keep it open while the request runs, and drop a previous error on reopen.
    if (deleteUser.isPending) return
    setOpen(next)
    deleteUser.reset()
  }

  if (isSelf) {
    return (
      <Button
        variant="ghost"
        size="icon-sm"
        disabled
        aria-label={`Delete ${user.email}`}
        title="You can't delete your own account"
      >
        <Trash2 />
      </Button>
    )
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Delete ${user.email}`}
          title="Delete user"
          className="text-destructive hover:bg-destructive/10 hover:text-destructive"
        >
          <Trash2 />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete user?</AlertDialogTitle>
          <AlertDialogDescription>
            This permanently deletes {user.name} ({user.email}) and signs them out everywhere. This
            can't be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {deleteUser.error && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            <CircleAlert className="mt-0.5 size-4 shrink-0" />
            <span>{deleteUser.error.message}</span>
          </div>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleteUser.isPending}>Cancel</AlertDialogCancel>
          {/* A plain button, not AlertDialogAction, so the dialog stays open on failure. */}
          <Button
            variant="destructive"
            disabled={deleteUser.isPending}
            onClick={() => deleteUser.mutate()}
          >
            {deleteUser.isPending ? (
              <>
                <LoaderCircle className="animate-spin" />
                Deleting…
              </>
            ) : (
              'Delete'
            )}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
