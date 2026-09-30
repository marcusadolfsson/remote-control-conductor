import type { RemoteAccount, RemoteHost, RemoteLaunch } from '@/lib/types'
import type { ProfileDialog } from './remote-profile-header'

import { useState } from 'react'

import { LogIn } from 'lucide-react'

import { PaneLayout } from '@/components/pane-layout'
import { Button } from '@/design'

import { useRemoteAccounts, useRemoteHostInfo, useRemoteHosts, useRemoteSessions } from '../api/use-remote'
import { DeleteRemoteAccountDialog } from './delete-remote-account-dialog'
import { EditRemoteProfileDialog } from './edit-remote-profile-dialog'
import { LaunchResultDialog } from './launch-result-dialog'
import { NewRemoteSessionDialog } from './new-remote-session-dialog'
import { RemoteProfileHeader } from './remote-profile-header'
import { RemoteSessions } from './remote-sessions'
import { SignInDialog } from './sign-in-dialog'
import { SignOutDialog } from './sign-out-dialog'
import { SwitchAccountDialog } from './switch-account-dialog'

type Props = {
  hostId: string
  account: string
  /** It was renamed: the sidebar selection follows it. */
  onRenamed?: (name: string) => void
}

type DetailProps = {
  /** The host the profile is on. */
  host: RemoteHost
  /** The profile's name. */
  accountName: string
  /** It was renamed: the sidebar selection follows it. */
  onRenamed?: (name: string) => void
}

/**
 * A launch to say more about, and the profile it runs under: a move's
 * resume runs under the profile it moved to, not this one.
 */
type ShownLaunch = { launch: RemoteLaunch; account: string }

type SignedOutNoticeProps = {
  /** The profile, once the host has listed it. */
  account: RemoteAccount | undefined
  /** The host can't be reached, so whether it's signed in isn't known. */
  offline: boolean
  /** Opens the sign-in dialog. */
  onSignIn: () => void
}

type ProfileDialogsProps = {
  /** The host the profile is on. */
  host: RemoteHost
  /** The profile's name. */
  accountName: string
  /** Every profile on the host, as it lists them. */
  accounts: Array<RemoteAccount>
  /** The dialog open, if any. */
  dialog: ProfileDialog | null
  /** Closes it. */
  onClose: () => void
  /** It was renamed: to this. */
  onRenamed: (name: string) => void
  /** A new session started, with more to say than that it did. */
  onResult: (launch: RemoteLaunch) => void
}

/**
 * A profile on a remote host (a Claude account there): whose it is, how long
 * its sign-in lasts, and its sessions, with where each running one is in tmux.
 */
export function RemoteAccountDetail({ hostId, account, onRenamed }: Props) {
  const host = useRemoteHosts().find((candidate) => candidate.id === hostId)
  if (!host) {
    return (
      <PaneLayout header={null}>
        <p className="text-body text-muted">That host is no longer paired.</p>
      </PaneLayout>
    )
  }
  return <Detail host={host} accountName={account} onRenamed={onRenamed} />
}

function Detail({ host, accountName, onRenamed }: DetailProps) {
  const accounts = useRemoteAccounts(host.id)
  const info = useRemoteHostInfo(host.id)
  const account = accounts.data?.find((candidate) => candidate.name === accountName)
  const offline = accounts.isError
  const [dialog, setDialog] = useState<ProfileDialog | null>(null)
  const [result, setResult] = useState<ShownLaunch | null>(null)

  return (
    <PaneLayout
      header={
        <RemoteProfileHeader host={host} name={accountName} account={account} offline={offline} onOpen={setDialog} />
      }
    >
      <SignedOutNotice account={account} offline={offline} onSignIn={() => setDialog('signIn')} />
      {accounts.isSuccess && !account ? (
        <p className="text-body text-muted">
          {host.label} has no profile called {accountName} any more.
        </p>
      ) : (
        <RemoteSessions
          host={host}
          account={accountName}
          email={account?.account?.email ?? null}
          home={info.data?.home}
          onResult={(launch, under) => setResult({ launch, account: under ?? accountName })}
        />
      )}
      <ProfileDialogs
        host={host}
        accountName={accountName}
        accounts={accounts.data ?? []}
        dialog={dialog}
        onClose={() => setDialog(null)}
        onRenamed={(name) => onRenamed?.(name)}
        onResult={(launch) => setResult({ launch, account: accountName })}
      />
      {result ? (
        <LaunchResultDialog
          host={host}
          account={result.account}
          launch={result.launch}
          onClose={() => setResult(null)}
        />
      ) : null}
    </PaneLayout>
  )
}

/** A signed-out profile: what that means for its sessions, and Sign in. Nothing for a signed-in one. */
function SignedOutNotice({ account, offline, onSignIn }: SignedOutNoticeProps) {
  if (!account || account.signedIn || offline) {
    return null
  }
  const resuming = account.pendingResume ?? 0
  return (
    <div className="mb-5 flex items-center justify-between gap-3 rounded-[10px] border border-border-soft px-[13px] py-[10px]">
      <p className="text-body text-ink-soft">
        {resuming > 0
          ? `Switching account: ${resuming} ${resuming === 1 ? 'session resumes' : 'sessions resume'} here as soon as it's signed in again.`
          : 'Signed out. Sessions started here will ask to sign in before they do anything.'}
      </p>
      <Button variant="secondary" size="sm" leadingIcon={<LogIn className="h-3.5 w-3.5" />} onClick={onSignIn}>
        Sign in
      </Button>
    </div>
  )
}

/**
 * What the header opens: a new session, signing in or out, switching the
 * account, editing the profile, and deleting it.
 */
function ProfileDialogs({ host, accountName, accounts, dialog, onClose, onRenamed, onResult }: ProfileDialogsProps) {
  const sessions = useRemoteSessions(host.id, accountName)
  const account = accounts.find((candidate) => candidate.name === accountName)
  const recentFolders = [
    ...new Set((sessions.data ?? []).map((session) => session.cwd).filter((cwd): cwd is string => cwd !== null)),
  ]
  return (
    <>
      <NewRemoteSessionDialog
        open={dialog === 'start'}
        host={host}
        account={accountName}
        recentFolders={recentFolders}
        onClose={onClose}
        onStarted={(launch) => {
          // As with Resume: only when there's more to say than that it
          // started, which the list shows.
          if (launch.attention || launch.alreadyRunning) {
            onResult(launch)
          }
        }}
      />
      <SignInDialog open={dialog === 'signIn'} host={host} account={accountName} onClose={onClose} />
      {account ? (
        <>
          <SignOutDialog open={dialog === 'signOut'} host={host} account={account} onClose={onClose} />
          <SwitchAccountDialog open={dialog === 'switch'} host={host} account={account} onClose={onClose} />
        </>
      ) : null}
      {dialog === 'edit' ? (
        <EditRemoteProfileDialog
          host={host}
          account={account ?? null}
          name={accountName}
          taken={accounts.map((candidate) => candidate.name)}
          onClose={onClose}
          onRenamed={onRenamed}
        />
      ) : null}
      {account ? (
        <DeleteRemoteAccountDialog
          open={dialog === 'delete'}
          host={host}
          account={account}
          onClose={onClose}
          onDeleted={() => undefined}
        />
      ) : null}
    </>
  )
}
