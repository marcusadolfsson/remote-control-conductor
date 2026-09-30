import type { ReactNode } from 'react'
import type { RemoteArchivedSession, RemoteHost, RemoteLaunch, RemoteSession, RemoteTransferReport } from '@/lib/types'
import type { Pending } from '../lib/confirm-end'
import type { RestartProgress } from '../lib/session-labels'

import { useState } from 'react'

import { RotateCw } from 'lucide-react'

import { Button, Skeleton } from '@/design'
import { sessionErrorMessage } from '@/features/profiles/components/session-error-message'
import { sessionPanelClasses, sessionRowClasses } from '@/features/profiles/components/session-row-base'
import { formatBytes } from '@/lib/format-bytes'

import { useRemoteArchivedSessions, useRemoteHostInfo, useRemoteSessions } from '../api/use-remote'
import { restartAllLabel, restartAllTitle } from '../lib/session-labels'
import { ConfirmEndDialog } from './confirm-end-dialog'
import { MoveRemoteSessionDialog } from './move-remote-session-dialog'
import { RemoteArchivedSessions } from './remote-archived-sessions'
import { RemoteSessionRow } from './remote-session-row'
import { RenameRemoteSessionDialog } from './rename-remote-session-dialog'
import { SessionWindowDialog } from './session-window-dialog'
import { busyFor, useRemoteSessionActions } from './use-remote-session-actions'

/** Previous sessions shown before "Show all". */
const collapsedCount = 8

type RemoteSessionsProps = {
  /** The host the profile is on. */
  host: RemoteHost
  /** The profile whose sessions these are. */
  account: string
  /** Whose account it is: Open in Claude goes to the app here signed in as it. */
  email: string | null
  /** The host's home folder, which folders are shortened against. */
  home?: string
  /**
   * A start or resume worth showing more about than a toast, and the profile
   * it runs under when that isn't this one (after a move).
   */
  onResult: (launch: RemoteLaunch, account?: string) => void
}

/** A dialog a row opens for its session. */
type SessionDialog = { kind: 'view' | 'rename' | 'move'; session: RemoteSession }

type SessionsBodyProps = {
  /** The profile's sessions, as the host lists them. */
  sessions: ReturnType<typeof useRemoteSessions>
  /** The host's name, for when they can't be read. */
  hostLabel: string
  /** The lists, once there are sessions to list. */
  children: ReactNode
}

type RunningSessionsProps = {
  /** The running sessions. */
  running: Array<RemoteSession>
  /** How far Restart all has got, while it runs. */
  progress: RestartProgress | null
  /** Something is under way: one at a time. */
  locked: boolean
  /** Asks to restart every running session. */
  onRestartAll: () => void
  /** A session's row. */
  row: (session: RemoteSession) => ReactNode
}

type SessionsFooterProps = {
  /** How many previous sessions there are. */
  previous: number
  /** Whether every previous session shows. */
  expanded: boolean
  /** The profile's archived sessions. */
  archived: Array<RemoteArchivedSession>
  /** Whether the archived sessions show. */
  showArchived: boolean
  /** Shows every previous session, or fewer. */
  onToggleExpanded: () => void
  /** Shows or hides the archived sessions. */
  onToggleArchived: () => void
}

type SessionDialogsProps = {
  /** The host the sessions are on. */
  host: RemoteHost
  /** The profile they're in. */
  account: string
  /** The dialog open, and for which session. */
  dialog: SessionDialog | null
  /** Closes it. */
  onClose: () => void
  /** A move is done; what it did. */
  onMoved: (report: RemoteTransferReport, to: string) => void
}

type SessionsHeadingProps = {
  /** What the list is. */
  title: string
  /** How many it holds. */
  count?: number
  /** Buttons across from the title. */
  children?: ReactNode
}

/**
 * The profile's sessions: the running ones, which can be stopped or
 * restarted (restarting is how a session picks up an upgraded `claude`), and
 * the previous ones, which can be resumed.
 */
export function RemoteSessions({ host, account, email, home, onResult }: RemoteSessionsProps) {
  const sessions = useRemoteSessions(host.id, account)
  const archived = useRemoteArchivedSessions(host.id, account)
  const actions = useRemoteSessionActions(host, account, onResult)
  const [dialog, setDialog] = useState<SessionDialog | null>(null)
  const [pending, setPending] = useState<Pending | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [showArchived, setShowArchived] = useState(false)
  const list = sessions.data ?? []
  const running = list.filter((session) => session.running)
  const previous = list.filter((session) => !session.running)

  const row = (session: RemoteSession) => (
    <RemoteSessionRow
      key={session.id}
      host={host}
      session={session}
      email={email}
      home={home}
      busy={busyFor(actions, session.id)}
      disabled={actions.locked}
      handlers={{
        onResume: () => void actions.resume(session),
        onRestart: () => void actions.restart(session),
        onStop: () => setPending({ kind: 'stop', session }),
        onMove: () => setDialog({ kind: 'move', session }),
        onRename: () => setDialog({ kind: 'rename', session }),
        onArchive: () => setPending({ kind: 'archive', session }),
        onView: () => setDialog({ kind: 'view', session }),
      }}
    />
  )

  return (
    <section aria-label="Sessions" className="mb-6">
      <SessionsBody sessions={sessions} hostLabel={host.label}>
        {running.length > 0 ? (
          <RunningSessions
            running={running}
            progress={actions.restartingAll}
            locked={actions.locked}
            onRestartAll={() => setPending({ kind: 'restartAll', sessions: running })}
            row={row}
          />
        ) : null}
        {previous.length > 0 ? (
          <div>
            <div className={sessionPanelClasses}>
              <ul aria-label="Previous sessions">
                {(expanded ? previous : previous.slice(0, collapsedCount)).map(row)}
              </ul>
            </div>
          </div>
        ) : null}
      </SessionsBody>
      <SessionsFooter
        previous={previous.length}
        expanded={expanded}
        archived={archived.data ?? []}
        showArchived={showArchived}
        onToggleExpanded={() => setExpanded((value) => !value)}
        onToggleArchived={() => setShowArchived((value) => !value)}
      />
      <RemoteArchivedSessions
        hostLabel={host.label}
        home={home}
        archived={archived.data ?? []}
        shown={showArchived}
        actions={actions}
      />
      <SessionDialogs
        host={host}
        account={account}
        dialog={dialog}
        onClose={() => setDialog(null)}
        onMoved={actions.moved}
      />
      <ConfirmEndDialog
        pending={pending}
        hostLabel={host.label}
        onClose={() => setPending(null)}
        onConfirm={(confirmed) => {
          setPending(null)
          actions.confirmed(confirmed)
        }}
      />
    </section>
  )
}

/** The lists, or where the listing stands: loading, failed, or empty. */
function SessionsBody({ sessions, hostLabel, children }: SessionsBodyProps) {
  if (sessions.isLoading) {
    return (
      <div className={sessionPanelClasses}>
        <div className={sessionRowClasses}>
          <Skeleton shape="text" className="w-2/3" />
        </div>
      </div>
    )
  }
  if (sessions.isError) {
    return (
      <div className={sessionPanelClasses}>
        <div className="flex items-center justify-between gap-3 px-[13px] py-[10px]">
          <p role="alert" className="text-meta text-red">
            {sessionErrorMessage(sessions.error, `Could not read ${hostLabel}'s sessions.`)}
          </p>
          <Button
            variant="ghost"
            size="sm"
            leadingIcon={<RotateCw className="h-3.5 w-3.5" />}
            onClick={() => void sessions.refetch()}
          >
            Retry
          </Button>
        </div>
      </div>
    )
  }
  if ((sessions.data ?? []).length === 0) {
    return (
      <>
        <SessionsHeading title="Sessions" />
        <div className={sessionPanelClasses}>
          <p className="px-[13px] py-[10px] text-meta text-muted">No sessions yet.</p>
        </div>
      </>
    )
  }
  return children
}

/**
 * The running sessions, with Restart all when there's more than one or any
 * waits on a restart to update.
 */
function RunningSessions({ running, progress, locked, onRestartAll, row }: RunningSessionsProps) {
  // Sessions on an older claude than the host now has installed.
  const updating = running.filter((session) => session.updatePending).length
  return (
    <div className="mb-4">
      <SessionsHeading title="Running" count={running.length}>
        {running.length > 1 || updating > 0 ? (
          <Button
            variant="ghost"
            size="sm"
            leadingIcon={<RotateCw className="h-3.5 w-3.5" />}
            disabled={locked}
            title={restartAllTitle(updating)}
            className={updating > 0 ? 'text-amber hover:text-amber' : undefined}
            onClick={onRestartAll}
          >
            {restartAllLabel(progress, updating)}
          </Button>
        ) : null}
      </SessionsHeading>
      <div className={sessionPanelClasses}>
        <ul aria-label="Running sessions">{running.map(row)}</ul>
      </div>
    </div>
  )
}

/** Under the lists, as on a local profile: Show all on the left, Archived on the right. */
function SessionsFooter({
  previous,
  expanded,
  archived,
  showArchived,
  onToggleExpanded,
  onToggleArchived,
}: SessionsFooterProps) {
  const collapsible = previous > collapsedCount
  if (!collapsible && archived.length === 0) {
    return null
  }
  const archivedBytes = archived.reduce((total, entry) => total + entry.sizeBytes, 0)
  return (
    <div className="mt-1.5 flex items-baseline justify-between px-0.5">
      {collapsible ? (
        <button
          type="button"
          className="cursor-pointer text-meta text-muted-strong hover:text-ink"
          onClick={onToggleExpanded}
        >
          {expanded ? 'Show fewer' : `Show all ${previous}`}
        </button>
      ) : (
        <span />
      )}
      {archived.length > 0 ? (
        <button
          type="button"
          aria-expanded={showArchived}
          className="cursor-pointer text-meta text-muted-strong hover:text-ink"
          onClick={onToggleArchived}
        >
          {showArchived ? 'Hide archived' : `Archived ${archived.length} · ${formatBytes(archivedBytes)}`}
        </button>
      ) : null}
    </div>
  )
}

/** The dialog a row opened: its window, renaming it, or moving it. */
function SessionDialogs({ host, account, dialog, onClose, onMoved }: SessionDialogsProps) {
  const hostInfo = useRemoteHostInfo(host.id)
  switch (dialog?.kind) {
    case 'view':
      return (
        <SessionWindowDialog
          host={host}
          account={account}
          session={dialog.session}
          // Only the windows the server opened can be shown and typed into.
          ours={dialog.session.window?.session === hostInfo.data?.tmux?.session}
          onClose={onClose}
        />
      )
    case 'rename':
      return <RenameRemoteSessionDialog host={host} account={account} session={dialog.session} onClose={onClose} />
    case 'move':
      return (
        <MoveRemoteSessionDialog
          open
          host={host}
          account={account}
          session={dialog.session}
          onClose={onClose}
          onMoved={onMoved}
        />
      )
    default:
      return null
  }
}

function SessionsHeading({ title, count, children }: SessionsHeadingProps) {
  return (
    <div className="mb-2 flex min-h-7 items-center justify-between px-0.5">
      <h2 className="text-meta font-medium text-ink-soft">
        {title}
        {count !== undefined ? <span className="ml-1.5 font-normal text-muted">{count}</span> : null}
      </h2>
      {children}
    </div>
  )
}
