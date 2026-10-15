import type { RcServer, RemoteHost } from '@/lib/types'

import { useState } from 'react'

import { ExternalLink, Radio, Square, SquareTerminal } from 'lucide-react'

import { Button, Dialog, Kbd } from '@/design'
import { sessionErrorMessage } from '@/features/profiles/components/session-error-message'
import { sessionPanelClasses, sessionRowClasses } from '@/features/profiles/components/session-row-base'
import { shortenHomePath } from '@/features/profiles/components/shorten-home-path'
import { openExternalUrl, remoteOpenInTerminal } from '@/lib/commands'

import { useRemoteRcServers, useStopRcServer } from '../api/use-remote'
import { tmuxAttach } from '../lib/tmux-attach'
import { folderName } from './new-remote-session-dialog'

type RemoteRcServersProps = {
  /** The host the profile is on. */
  host: RemoteHost
  /** The profile whose servers these are. */
  account: string
  /** The host's home folder, which folders are shortened against. */
  home?: string
}

/**
 * The profile's Remote Control servers: `claude remote-control` in a folder,
 * so the Claude apps on another device can start sessions there. Nothing
 * when there are none, or the host's server is too old to say.
 */
export function RemoteRcServers({ host, account, home }: RemoteRcServersProps) {
  const servers = useRemoteRcServers(host.id, account)
  const stop = useStopRcServer(host.id, account)
  const [stopping, setStopping] = useState<RcServer | null>(null)
  const list = servers.data ?? []
  if (list.length === 0) {
    return null
  }
  return (
    <section aria-label="Remote Control servers" className="mb-6">
      <div className="mb-2 flex min-h-7 items-center px-0.5">
        <h2 className="text-meta font-medium text-ink-soft">
          Remote Control servers<span className="ml-1.5 font-normal text-muted">{list.length}</span>
        </h2>
      </div>
      <div className={sessionPanelClasses}>
        <ul aria-label="Remote Control servers">
          {list.map((server) => (
            <RcServerRow
              key={server.pid}
              host={host}
              server={server}
              home={home}
              stopping={stop.isPending && stop.variables === server.pid}
              onStop={() => setStopping(server)}
            />
          ))}
        </ul>
      </div>
      {stop.isError ? (
        <p role="alert" className="mt-1.5 px-0.5 text-meta text-red">
          {sessionErrorMessage(stop.error, 'The Remote Control server could not be stopped.')}
        </p>
      ) : null}
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

type RcServerRowProps = {
  /** The host it runs on. */
  host: RemoteHost
  /** The server. */
  server: RcServer
  /** The host's home, to shorten its folder by. */
  home?: string
  /** It's being stopped now. */
  stopping: boolean
  /** Asks to stop it. */
  onStop: () => void
}

/** One server: its name and folder, how it places sessions, how many it serves, and what can be done with it. */
function RcServerRow({ host, server, home, stopping, onStop }: RcServerRowProps) {
  const detail = [
    shortenHomePath(server.folder, home),
    server.spawn === 'worktree' ? 'a worktree per session' : 'sessions in this folder',
    `${server.sessions} ${server.sessions === 1 ? 'session' : 'sessions'}`,
    server.window ? null : 'started elsewhere',
  ]
    .filter(Boolean)
    .join(' · ')
  return (
    <li className={sessionRowClasses}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <Radio
            aria-hidden
            className={server.attention ? 'h-4 w-4 shrink-0 text-amber' : 'h-4 w-4 shrink-0 text-blue'}
          />
          <div className="min-w-0">
            <p className="truncate text-body text-ink">{server.name ?? folderName(server.folder)}</p>
            <p className="truncate text-meta text-muted">{detail}</p>
          </div>
        </div>
        <RcServerActions host={host} server={server} stopping={stopping} onStop={onStop} />
      </div>
      {server.attention ? (
        <p className="mt-1.5 whitespace-pre-line text-meta text-amber">{server.attention.text}</p>
      ) : null}
    </li>
  )
}

type RcServerActionsProps = Omit<RcServerRowProps, 'home'>

/** Its page on claude.ai, its tmux window in Terminal, and Stop, for the ones the host started. */
function RcServerActions({ host, server, stopping, onStop }: RcServerActionsProps) {
  const attach = tmuxAttach(server)
  return (
    <div className="flex shrink-0 items-center gap-1">
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
      {attach ? (
        <Button
          variant="ghost"
          size="sm"
          aria-label="Open its window in Terminal"
          title={server.attention ? 'Answer it in its tmux window, in Terminal' : 'Its tmux window, in Terminal'}
          onClick={() => void remoteOpenInTerminal({ hostId: host.id, attachCommand: attach })}
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
