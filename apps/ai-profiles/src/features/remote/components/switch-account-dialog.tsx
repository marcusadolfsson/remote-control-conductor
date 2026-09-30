import type { RemoteAccount, RemoteHost } from '@/lib/types'

import { useEffect, useState } from 'react'

import { Button, Dialog, Kbd, useToast } from '@/design'
import { sessionErrorMessage } from '@/features/profiles/components/session-error-message'

import { useSwitchAccountSignOut } from '../api/use-remote'
import { sameAccount, sessionCount, switchEffect } from '../lib/switch-account'
import { SignInDialog } from './sign-in-dialog'

type Props = {
  open: boolean
  host: RemoteHost
  account: RemoteAccount
  onClose: () => void
}

type Step = 'confirm' | 'signingIn' | 'sameAccount'

/**
 * Switching a profile to another Claude account, say from personal to work:
 * its running sessions stop, it signs out, and it signs in
 * as the other account in the browser. The host then resumes the same
 * sessions under it. Nothing moves, and no other profile is touched.
 */
export function SwitchAccountDialog({ open, host, account, onClose }: Props) {
  const signOut = useSwitchAccountSignOut(host.id, account.name)
  const toast = useToast()
  const [step, setStep] = useState<Step>('confirm')
  const [previous, setPrevious] = useState<string | null>(null)
  const current = account.account?.email ?? null

  // biome-ignore lint/correctness/useExhaustiveDependencies: start over each time it opens
  useEffect(() => {
    if (open) {
      setStep('confirm')
      signOut.reset()
    }
  }, [open])

  async function handleSwitch() {
    setPrevious(current ?? previous)
    try {
      await signOut.mutateAsync()
      setStep('signingIn')
    } catch {
      // Shown in the dialog.
    }
  }

  function handleSignedIn(signed: RemoteAccount) {
    const now = signed.account?.email ?? null
    if (sameAccount(previous, now)) {
      setStep('sameAccount')
      return
    }
    const resuming = signed.pendingResume ?? 0
    toast.success(
      `${account.name} is on ${now ?? 'another account'}`,
      resuming > 0 ? `${sessionCount(resuming)} resuming, in the same conversations.` : `On ${host.label}.`,
    )
    onClose()
  }

  if (!open) {
    return null
  }
  if (step === 'signingIn') {
    return (
      <SignInDialog
        open
        host={host}
        account={account.name}
        title={`Sign ${account.name} in to the other account`}
        cancelLabel="Later"
        onSignedIn={handleSignedIn}
        onClose={onClose}
      />
    )
  }
  if (step === 'sameAccount') {
    return (
      <SameAccountDialog
        profile={account.name}
        previous={previous}
        signingOut={signOut.isPending}
        onClose={onClose}
        onRetry={handleSwitch}
      />
    )
  }
  return (
    <ConfirmSwitchDialog
      host={host}
      account={account}
      signingOut={signOut.isPending}
      error={signOut.isError ? signOut.error : null}
      onClose={onClose}
      onSwitch={handleSwitch}
    />
  )
}

type ConfirmSwitchDialogProps = {
  /**
   * The host the profile is on.
   */
  host: RemoteHost
  /**
   * The profile to switch.
   */
  account: RemoteAccount
  /**
   * Whether it is signing out now.
   */
  signingOut: boolean
  /**
   * Why signing out failed, if it did.
   */
  error: unknown
  /**
   * Closes without switching.
   */
  onClose: () => void
  /**
   * Signs the profile out, to sign in as the other account.
   */
  onSwitch: () => void
}

/**
 * What switching does, before it's done: which sessions stop and resume,
 * and which account to sign in as in the browser.
 */
function ConfirmSwitchDialog({ host, account, signingOut, error, onClose, onSwitch }: ConfirmSwitchDialogProps) {
  const current = account.account?.email ?? null
  return (
    <Dialog
      open
      title={`Switch ${account.name} to another account?`}
      description={current ? `Signed in as ${current}, on ${host.label}.` : `On ${host.label}.`}
      onClose={onClose}
      onSubmit={onSwitch}
      foot={
        <>
          <Button variant="ghost" size="sm" trailingKbd={<Kbd>⎋</Kbd>} disabled={signingOut} onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            trailingKbd={<Kbd variant="onOrange">⏎</Kbd>}
            disabled={signingOut}
            onClick={onSwitch}
          >
            {signingOut ? 'Signing out…' : 'Switch account'}
          </Button>
        </>
      }
    >
      <div className="space-y-2.5 text-body text-ink-soft">
        <p>{switchEffect(account.runningSessions)}</p>
        <p className="text-muted">
          A sign-in page opens in your browser. Sign in there as the other account
          {current ? `: if claude.ai shows ${current}, switch account on claude.ai first` : ''}.
        </p>
        {error ? (
          <p role="alert" className="text-meta text-red">
            {sessionErrorMessage(error, 'It could not be signed out.')}
          </p>
        ) : null}
      </div>
    </Dialog>
  )
}

type SameAccountDialogProps = {
  /**
   * The profile being switched.
   */
  profile: string
  /**
   * The account it was on, and is on again.
   */
  previous: string | null
  /**
   * Whether it is signing out again now.
   */
  signingOut: boolean
  /**
   * Keeps the account it's on.
   */
  onClose: () => void
  /**
   * Signs out again, to sign in as another account.
   */
  onRetry: () => void
}

/**
 * The browser signed the profile in to the account it was already on.
 */
function SameAccountDialog({ profile, previous, signingOut, onClose, onRetry }: SameAccountDialogProps) {
  return (
    <Dialog
      open
      title={`Still ${previous}`}
      description={`${profile} signed in to the same account again.`}
      onClose={onClose}
      foot={
        <>
          <Button variant="ghost" size="sm" trailingKbd={<Kbd>⎋</Kbd>} onClick={onClose}>
            Keep it
          </Button>
          <Button variant="primary" size="sm" disabled={signingOut} onClick={onRetry}>
            {signingOut ? 'Signing out…' : 'Sign in as another'}
          </Button>
        </>
      }
    >
      <p className="text-body text-ink-soft">
        The browser was still signed in to claude.ai as {previous}. Switch account on claude.ai first, then sign in
        again. Its sessions are running again meanwhile.
      </p>
    </Dialog>
  )
}
