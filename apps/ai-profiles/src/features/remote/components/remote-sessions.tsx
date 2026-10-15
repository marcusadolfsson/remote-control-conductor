import type { ReactNode } from 'react'
import type {
  RcServer,
  RemoteArchivedSession,
  RemoteHost,
  RemoteLaunch,
  RemoteSession,
  RemoteTransferReport,
} from '@/lib/types'
import type { Pending } from '../lib/confirm-end'
import type { RestartProgress } from '../lib/session-labels'

import { useState } from 'react'

import { RotateCw } from 'lucide-react'

import { Button, Skeleton } from '@/design'
import { sessionErrorMessage } from '@/features/profiles/components/session-error-message'
import { sessionPanelClasses, sessionRowClasses } from '@/features/profiles/components/session-row-base'
import { formatBytes } from '@/lib/format-bytes'

import { useRemoteArchivedSessions, useRemoteHostInfo, useRemoteRcServers, useRemoteSessions } from '../api/use-remote'
import { isMacHost } from '../lib/mac-host'
import { groupByServer } from '../lib/served'
import { installedVersionOf, restartAllLabel, restartAllTitle } from '../lib/session-labels'
import { ConfirmEndDialog } from './confirm-end-dialog'
import { MoveRemoteSessionDialog } from './move-remote-session-dialog'
import { ServerHereDialog, useServerHere } from './rc-server-dialog'
import { RemoteArchivedSessions } from './remote-archived-sessions'
import { RemoteRcServers } from './remote-rc-servers'
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
  /** The host, named when they can't be read. */
  host: RemoteHost
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
 * The profile's Remote Control servers, with the sessions each serves under
 * it, then its other sessions: the running ones, which can be stopped or
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
  const serverHere = useServerHere(host.id, account)
  const { byServer, running, previous } = useGroupedSessions(host.id, account, sessions.data)

  const row = (session: RemoteSession) => (
    <RemoteSessionRow
      key={session.id}
      host={host}
      session={session}
      email={email}
      home={home}
      busy={busyFor(actions, session.id)}
      disabled={actions.locked}
      handlers={rowHandlers(session, { actions, setDialog, setPending, offerServer: serverHere.offer })}
    />
  )

  return (
    <>
      <RemoteRcServers host={host} account={account} home={home} sessionsOf={servedRows(byServer, row)} />
      <section aria-label="Sessions" className="mb-6">
        <SessionsBody sessions={sessions} host={host}>
          {running.length > 0 ? (
            <RunningSessions
              running={running}
              progress={actions.restartingAll}
              locked={actions.locked}
              onRestartAll={() => setPending({ kind: 'restartAll', sessions: running })}
              row={row}
            />
          ) : null}
          <PreviousSessions previous={previous} expanded={expanded} row={row} />
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
        <ServerHereDialog host={host} account={account} here={serverHere} />
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
    </>
  )
}

/** The sessions each Remote Control server serves, by its pid, then the running and previous rest. */
function useGroupedSessions(hostId: string, account: string, sessions: Array<RemoteSession> = []) {
  const servers = useRemoteRcServers(hostId, account)
  const { byServer, rest } = groupByServer(sessions, servers.data)
  return { byServer, ...splitSessions(rest) }
}

type PreviousSessionsProps = {
  /** The sessions not running. */
  previous: Array<RemoteSession>
  /** Whether all show, or only the first few. */
  expanded: boolean
  /** A session's row. */
  row: (session: RemoteSession) => ReactNode
}

/** The sessions not running; nothing when there are none. */
function PreviousSessions({ previous, expanded, row }: PreviousSessionsProps) {
  if (previous.length === 0) {
    return null
  }
  return (
    <div>
      <div className={sessionPanelClasses}>
        <ul aria-label="Previous sessions">{(expanded ? previous : previous.slice(0, collapsedCount)).map(row)}</ul>
      </div>
    </div>
  )
}

/** The rows of the sessions each server serves. */
function servedRows(byServer: Map<number, Array<RemoteSession>>, row: (session: RemoteSession) => ReactNode) {
  return (server: RcServer) => byServer.get(server.pid)?.map(row)
}

/** The running sessions, and the previous ones. */
function splitSessions(list: Array<RemoteSession> = []) {
  return {
    running: list.filter((session) => session.running),
    previous: list.filter((session) => !session.running),
  }
}

type RowWiring = {
  /** The session actions, which run against the host. */
  actions: ReturnType<typeof useRemoteSessionActions>
  /** Opens a dialog for a session. */
  setDialog: (dialog: SessionDialog) => void
  /** Holds an action for the user to confirm. */
  setPending: (pending: Pending) => void
  /** "Remote Control server here…" for a session, when offered. */
  offerServer: (session: RemoteSession) => (() => void) | undefined
}

/** What a session's row buttons do. */
function rowHandlers(session: RemoteSession, { actions, setDialog, setPending, offerServer }: RowWiring) {
  return {
    onResume: () => void actions.resume(session),
    onRestart: () => void actions.restart(session),
    onStop: () => setPending({ kind: 'stop', session }),
    onMove: () => setDialog({ kind: 'move', session }),
    onRename: () => setDialog({ kind: 'rename', session }),
    onArchive: () => setPending({ kind: 'archive', session }),
    onView: () => setDialog({ kind: 'view', session }),
    onServerHere: offerServer(session),
  }
}

/** The lists, or where the listing stands: loading, failed, or empty. */
function SessionsBody({ sessions, host, children }: SessionsBodyProps) {
  const info = useRemoteHostInfo(host.id)
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
            {sessionErrorMessage(sessions.error, `Could not read ${host.label}'s sessions.`)}
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
    // A shared Mac has servers, never sessions of its own to list.
    if (isMacHost(info.data)) {
      return null
    }
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
  const waiting = running.filter((session) => session.updatePending)
  const updating = waiting.length
  const installed = installedVersionOf(waiting)
  return (
    <div className="mb-4">
      <SessionsHeading title="Running" count={running.length}>
        {running.length > 1 || updating > 0 ? (
          <Button
            variant="ghost"
            size="sm"
            leadingIcon={<RotateCw className="h-3.5 w-3.5" />}
            disabled={locked}
            title={restartAllTitle(updating, installed)}
            className={updating > 0 ? 'text-amber hover:text-amber' : undefined}
            onClick={onRestartAll}
          >
            {restartAllLabel(progress, updating, installed)}
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
