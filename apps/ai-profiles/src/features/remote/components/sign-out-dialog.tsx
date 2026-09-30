import type { RemoteAccount, RemoteHost } from '@/lib/types'

import { Button, Dialog, Kbd, useToast } from '@/design'
import { sessionErrorMessage } from '@/features/profiles/components/session-error-message'

import { useRemoteLogout } from '../api/use-remote'

/**
 * Signing a profile out: `claude auth logout` on the host. Its running
 * sessions would go on until their token next renews and then fail, so they
 * are stopped first, which this says before it's done.
 */
export function SignOutDialog({
  open,
  host,
  account,
  onClose,
}: {
  open: boolean
  host: RemoteHost
  account: RemoteAccount
  onClose: () => void
}) {
  const logout = useRemoteLogout(host.id, account.name)
  const toast = useToast()
  const running = account.runningSessions
  async function handleSignOut() {
    try {
      const stopped = await logout.mutateAsync(running > 0)
      toast.success(
        `Signed out ${account.name}`,
        stopped > 0
          ? `${stopped} running ${stopped === 1 ? 'session was' : 'sessions were'} stopped first.`
          : undefined,
      )
      onClose()
    } catch (caught) {
      toast.error('Could not sign it out.', sessionErrorMessage(caught))
    }
  }
  return (
    <Dialog
      open={open}
      title={`Sign out ${account.name}?`}
      description={account.account?.email ?? `On ${host.label}.`}
      onClose={onClose}
      onSubmit={handleSignOut}
      foot={
        <>
          <Button variant="ghost" size="sm" trailingKbd={<Kbd>⎋</Kbd>} disabled={logout.isPending} onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" size="sm" disabled={logout.isPending} onClick={handleSignOut}>
            {logout.isPending ? 'Signing out…' : running > 0 ? 'Stop sessions and sign out' : 'Sign out'}
          </Button>
        </>
      }
    >
      <p className="text-body text-ink-soft">
        {running > 0
          ? `${running} ${running === 1 ? 'session is' : 'sessions are'} running. ${running === 1 ? 'It stops' : 'They stop'} first: signed out, ${running === 1 ? 'it' : 'they'} would fail as soon as the token renews. `
          : ''}
        Its sessions are kept. Sign in again to use them.
      </p>
    </Dialog>
  )
}
