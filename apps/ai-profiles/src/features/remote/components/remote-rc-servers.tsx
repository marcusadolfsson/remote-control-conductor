import type { ReactNode } from 'react'
import type { RcServer, RemoteHost } from '@/lib/types'

import { useState } from 'react'

import { ExternalLink, Radio, RotateCw, Square, SquareTerminal } from 'lucide-react'

import { Button, cn, Dialog, Kbd } from '@/design'
import { sessionErrorMessage } from '@/features/profiles/components/session-error-message'
import { sessionPanelClasses, sessionRowClasses } from '@/features/profiles/components/session-row-base'
import { shortenHomePath } from '@/features/profiles/components/shorten-home-path'
import { openExternalUrl } from '@/lib/commands'

import { useRemoteRcServers, useRestartAllRcServers, useRestartRcServer, useStopRcServer } from '../api/use-remote'
import { restartAllServersLabel, restartAllServersTitle } from '../lib/server-labels'
import { updateVersions } from '../lib/session-labels'
import { folderName } from './new-remote-session-dialog'
import { SessionWindowDialog } from './session-window-dialog'

type RemoteRcServersProps = {
  /** The host the profile is on. */
  host: RemoteHost
  /** The profile whose servers these are. */
  account: string
  /** The host's home folder, which folders are shortened against. */
  home?: string
  /** Starting one, from a button by the heading; with it, the section shows even when there are none. */
  onStart?: () => void
  /** The rows of the sessions a server serves, listed under it. */
  sessionsOf?: (server: RcServer) => ReactNode
}

/**
 * The profile's Remote Control servers: `claude remote-control` in a folder,
 * so the Claude apps on another device can start sessions there. Nothing
 * when there are none, or the host's server is too old to say.
 */
export function RemoteRcServers({ host, account, home, onStart, sessionsOf }: RemoteRcServersProps) {
  const servers = useRemoteRcServers(host.id, account)
  const stop = useStopRcServer(host.id, account)
  const restart = useRestartRcServer(host.id, account)
  const [stopping, setStopping] = useState<RcServer | null>(null)
  const [updating, setUpdating] = useState<RcServer | null>(null)
  const [viewing, setViewing] = useState<RcServer | null>(null)
  const list = servers.data ?? []
  if (list.length === 0 && !onStart) {
    return null
  }
  return (
    <section aria-label="Remote Control servers" className="mb-6">
      <RcServersHeading count={list.length} onStart={onStart}>
        <RestartAllServers host={host} account={account} servers={list} />
      </RcServersHeading>
      {list.length === 0 ? null : (
        <div className={sessionPanelClasses}>
          <ul aria-label="Remote Control servers">
            {list.map((server) => (
              <RcServerRow
                key={server.pid}
                server={server}
                home={home}
                stopping={
                  (stop.isPending && stop.variables === server.pid) ||
                  (restart.isPending && restart.variables?.pid === server.pid)
                }
                onView={() => setViewing(server)}
                onStop={() => setStopping(server)}
                onUpdate={() => setUpdating(server)}
              >
                {sessionsOf?.(server)}
              </RcServerRow>
            ))}
          </ul>
        </div>
      )}
      {stop.isError ? (
        <p role="alert" className="mt-1.5 px-0.5 text-meta text-red">
          {sessionErrorMessage(stop.error, 'The Remote Control server could not be stopped.')}
        </p>
      ) : null}
      {restart.isError ? (
        <p role="alert" className="mt-1.5 px-0.5 text-meta text-red">
          {sessionErrorMessage(restart.error, 'The Remote Control server could not be restarted.')}
        </p>
      ) : null}
      {viewing ? (
        <SessionWindowDialog
          host={host}
          account={account}
          session={{
            id: String(viewing.pid),
            title: viewing.name ?? folderName(viewing.folder),
            lastPrompt: null,
            window: viewing.window,
          }}
          ours
          onClose={() => setViewing(null)}
        />
      ) : null}
      <UpdateServerDialog
        server={updating}
        onClose={() => setUpdating(null)}
        onConfirm={(server) => {
          setUpdating(null)
          restart.mutate(server)
        }}
      />
      <StopServerDialog
        server={stopping}
        onClose={() => setStopping(null)}
        onConfirm={(server) => {
          setStopping(null)
          stop.mutate(server.pid)
        }}
      />
    </section>
  )
}

type RcServersHeadingProps = {
  /** How many there are. */
  count: number
  /** Starts one, when it can be started from here. */
  onStart?: () => void
  /** More buttons, before Start…. */
  children?: ReactNode
}

/** "Remote Control servers", how many, and Start… where they can be started here. */
function RcServersHeading({ count, onStart, children }: RcServersHeadingProps) {
  return (
    <div className="mb-2 flex min-h-7 items-center justify-between px-0.5">
      <h2 className="text-meta font-medium text-ink-soft">
        Remote Control servers
        {count > 0 ? <span className="ml-1.5 font-normal text-muted">{count}</span> : null}
      </h2>
      <div className="flex items-center gap-1">
        {children}
        {onStart ? (
          <Button variant="ghost" size="sm" leadingIcon={<Radio className="h-3.5 w-3.5" />} onClick={onStart}>
            Start…
          </Button>
        ) : null}
      </div>
    </div>
  )
}

type RestartAllServersProps = {
  /** The host they run on. */
  host: RemoteHost
  /** The profile they run as. */
  account: string
  /** The profile's servers. */
  servers: Array<RcServer>
}

/**
 * Restart all: every server this side started, one after another, on the
 * Claude Code installed now. Offered when there's more than one, or any
 * waits on an update.
 */
function RestartAllServers({ host, account, servers }: RestartAllServersProps) {
  const restart = useRestartAllRcServers(host.id, account)
  const [asking, setAsking] = useState(false)
  const ours = servers.filter((server) => server.window)
  const outdated = ours.filter((server) => server.updatePending).length
  if (ours.length === 0 || (ours.length === 1 && outdated === 0)) {
    return null
  }
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        leadingIcon={<RotateCw className="h-3.5 w-3.5" />}
        className={outdated > 0 ? 'text-amber hover:text-amber' : undefined}
        title={restartAllServersTitle(ours.length, outdated)}
        disabled={restart.isPending}
        onClick={() => setAsking(true)}
      >
        {restart.isPending ? 'Restarting…' : restartAllServersLabel(outdated)}
      </Button>
      {restart.data && restart.data.length > 0 ? (
        <span role="alert" className="text-meta text-red" title={restart.data.join('\n')}>
          {restart.data.length} didn't restart
        </span>
      ) : null}
      <RestartAllDialog
        open={asking}
        count={ours.length}
        onClose={() => setAsking(false)}
        onConfirm={() => {
          setAsking(false)
          restart.mutate(ours)
        }}
      />
    </>
  )
}

type RcServerRowProps = {
  /** The server. */
  server: RcServer
  /** The host's home, to shorten its folder by. */
  home?: string
  /** It's being stopped now. */
  stopping: boolean
  /** Shows its tmux window, here. */
  onView: () => void
  /** Asks to stop it. */
  onStop: () => void
  /** Asks to restart it on the Claude Code installed now. */
  onUpdate: () => void
  /** The rows of the sessions it serves. */
  children?: ReactNode
}

/** One server: its name and folder, how it places sessions, how many it serves, and what can be done with it. */
function RcServerRow({ server, home, stopping, onView, onStop, onUpdate, children }: RcServerRowProps) {
  const detail = [
    shortenHomePath(server.folder, home),
    server.spawn === 'worktree' ? 'a worktree per session' : 'sessions in this folder',
    `${server.sessions} ${server.sessions === 1 ? 'session' : 'sessions'}`,
    server.window ? null : 'started elsewhere',
  ]
    .filter(Boolean)
    .join(' · ')
  return (
    <li className={cn(sessionRowClasses, 'flex-col items-stretch gap-0')}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          <Radio
            aria-hidden
            className={server.attention ? 'h-4 w-4 shrink-0 text-amber' : 'h-4 w-4 shrink-0 text-blue'}
          />
          <div className="min-w-0">
            <p className="truncate text-body text-ink">{server.name ?? folderName(server.folder)}</p>
            <p className="truncate text-meta text-muted">{detail}</p>
          </div>
        </div>
        <RcServerActions server={server} stopping={stopping} onView={onView} onStop={onStop} onUpdate={onUpdate} />
      </div>
      {server.attention ? (
        <p className="mt-1.5 whitespace-pre-line text-meta text-amber">{server.attention.text}</p>
      ) : null}
      <ServedSessions>{children}</ServedSessions>
    </li>
  )
}

/** The sessions a server serves, indented under it; nothing when there are none. */
function ServedSessions({ children }: { children?: ReactNode }) {
  const rows = Array.isArray(children) ? children : children ? [children] : []
  if (rows.length === 0) {
    return null
  }
  return (
    <ul aria-label="Sessions it serves" className="mt-1.5 -mb-[8px] -mr-[13px] ml-6 border-l border-border-soft">
      {rows}
    </ul>
  )
}

type RcServerActionsProps = Omit<RcServerRowProps, 'home' | 'children'>

/** Its page on claude.ai, and its tmux window and Stop, for the ones the host started. */
function RcServerActions({ server, stopping, onView, onStop, onUpdate }: RcServerActionsProps) {
  return (
    <div className="flex shrink-0 items-center gap-1">
      {server.window && server.updatePending ? (
        <Button
          variant="ghost"
          size="sm"
          aria-label="Restart to update"
          title={`Restart to update Claude Code (${updateVersions(server) ?? 'a newer version is installed'})`}
          className="text-amber hover:text-amber"
          disabled={stopping}
          onClick={onUpdate}
        >
          <RotateCw aria-hidden className="h-3.5 w-3.5" />
        </Button>
      ) : null}
      {server.environmentUrl ? (
        <Button
          variant="ghost"
          size="sm"
          leadingIcon={<ExternalLink className="h-3.5 w-3.5" />}
          title="Start sessions here from claude.ai"
          onClick={() => void openExternalUrl(server.environmentUrl ?? '')}
        >
          Open
        </Button>
      ) : null}
      {server.window ? (
        <Button
          variant="ghost"
          size="sm"
          aria-label="Open its window"
          title={
            server.attention
              ? 'Answer it in its tmux window, here or in Terminal'
              : 'Its tmux window, here or in Terminal'
          }
          onClick={onView}
        >
          <SquareTerminal aria-hidden className="h-3.5 w-3.5" />
        </Button>
      ) : null}
      {server.window ? (
        <Button
          variant="ghost"
          size="sm"
          aria-label="Stop"
          title="Stop this server"
          disabled={stopping}
          onClick={onStop}
        >
          <Square aria-hidden className="h-3.5 w-3.5" />
        </Button>
      ) : null}
    </div>
  )
}

type UpdateServerDialogProps = {
  /** The server to restart, asked about; closed while there's none. */
  server: RcServer | null
  /** Leaves it as it is. */
  onClose: () => void
  /** Restarts it. */
  onConfirm: (server: RcServer) => void
}

/** Asks before restarting a server to update it: its sessions pause while it does. */
function UpdateServerDialog({ server, onClose, onConfirm }: UpdateServerDialogProps) {
  const serving = server?.sessions ?? 0
  const versions = server ? updateVersions(server) : null
  return (
    <Dialog
      open={server !== null}
      title="Restart this Remote Control server to update?"
      description={server?.folder}
      onClose={onClose}
      onSubmit={() => server && onConfirm(server)}
      foot={
        <>
          <Button variant="ghost" size="sm" trailingKbd={<Kbd>⎋</Kbd>} onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" trailingKbd={<Kbd>⏎</Kbd>} onClick={() => server && onConfirm(server)}>
            Restart
          </Button>
        </>
      }
    >
      <p className="text-body text-ink-soft">
        It starts again on the Claude Code installed now{versions ? ` (${versions})` : ''}
        {serving > 0
          ? `. The ${serving} ${serving === 1 ? 'session' : 'sessions'} it serves stop answering for a moment and come back with it.`
          : '.'}
      </p>
    </Dialog>
  )
}

type RestartAllDialogProps = {
  /** Whether it's asking. */
  open: boolean
  /** How many servers would restart. */
  count: number
  /** Leaves them as they are. */
  onClose: () => void
  /** Restarts them. */
  onConfirm: () => void
}

/** Asks before restarting every server: their sessions pause while they do. */
function RestartAllDialog({ open, count, onClose, onConfirm }: RestartAllDialogProps) {
  return (
    <Dialog
      open={open}
      title={`Restart all ${count} Remote Control servers?`}
      onClose={onClose}
      onSubmit={onConfirm}
      foot={
        <>
          <Button variant="ghost" size="sm" trailingKbd={<Kbd>⎋</Kbd>} onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" trailingKbd={<Kbd>⏎</Kbd>} onClick={onConfirm}>
            Restart all
          </Button>
        </>
      }
    >
      <p className="text-body text-ink-soft">
        Each starts again on the Claude Code installed now, one after another. The sessions they serve stop answering
        for a moment and come back with them.
      </p>
    </Dialog>
  )
}

type StopServerDialogProps = {
  /** The server to stop, asked about; closed while there's none. */
  server: RcServer | null
  /** Leaves it running. */
  onClose: () => void
  /** Stops it. */
  onConfirm: (server: RcServer) => void
}

/** Asks before stopping a server: the sessions it serves stop answering. */
function StopServerDialog({ server, onClose, onConfirm }: StopServerDialogProps) {
  const serving = server?.sessions ?? 0
  return (
    <Dialog
      open={server !== null}
      title="Stop this Remote Control server?"
      description={server?.folder}
      onClose={onClose}
      onSubmit={() => server && onConfirm(server)}
      foot={
        <>
          <Button variant="ghost" size="sm" trailingKbd={<Kbd>⎋</Kbd>} onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" size="sm" trailingKbd={<Kbd>⏎</Kbd>} onClick={() => server && onConfirm(server)}>
            Stop
          </Button>
        </>
      }
    >
      <p className="text-body text-ink-soft">
        The Claude apps can no longer start sessions in this folder
        {serving > 0 ? `, and the ${serving} ${serving === 1 ? 'session' : 'sessions'} it serves stop answering` : ''}.
        Starting a server here again within a few hours brings them back.
      </p>
    </Dialog>
  )
}
