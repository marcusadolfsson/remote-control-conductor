import type { RemoteHost, RemoteSession } from '@/lib/types'
import type { BusyAction } from './use-remote-session-actions'

import {
  Archive,
  LoaderCircle,
  MessageSquareReply,
  MoreHorizontal,
  Play,
  RotateCw,
  Square,
  SquareTerminal,
} from 'lucide-react'

import { Button, cn, StatusDot } from '@/design'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/design/ui/dropdown-menu'
import { SessionRowBase } from '@/features/profiles/components/session-row-base'

import { restartTitle, sessionTitle } from '../lib/session-labels'
import { attachCommand, tmuxAttach } from '../lib/tmux-attach'
import { OpenInClaudeButton } from './open-in-claude-button'

/**
 * A row's actions are held while another is under way (one at a time), but
 * without the not-allowed cursor: it would show under the pointer the moment
 * one is clicked.
 */
export const rowActionClasses = 'disabled:cursor-default'

/** What a row's buttons do. */
type RemoteSessionRowHandlers = {
  /** Resumes a previous session, or answers a waiting one. */
  onResume: () => void
  /** Restarts a running session. */
  onRestart: () => void
  /** Asks to stop it. */
  onStop: () => void
  /** Opens the move dialog. */
  onMove: () => void
  /** Opens the rename dialog. */
  onRename: () => void
  /** Asks to archive it. */
  onArchive: () => void
  /** Open its window in Remote Control Conductor. */
  onView: () => void
}

type RemoteSessionRowProps = {
  /** The host the session is on. */
  host: RemoteHost
  /** The session the row is for. */
  session: RemoteSession
  /** Whose account it is: Open in Claude goes to the app here signed in as it. */
  email: string | null
  /** The host's home folder, which folders are shortened against. */
  home?: string
  /** What the host is doing to this session, if anything. */
  busy: BusyAction | null
  /** Another session is being changed: one at a time. */
  disabled: boolean
  /** What its buttons do. */
  handlers: RemoteSessionRowHandlers
}

type SessionActionsProps = Omit<RemoteSessionRowProps, 'home'>

type SessionBadgesProps = {
  /** The session the badges describe. */
  session: RemoteSession
  /** What the host is doing to it, if anything. */
  busy: BusyAction | null
}

type HeldActionsProps = {
  /** What the host is doing to this session, if anything. */
  busy: BusyAction | null
  /** Another session is being changed: one at a time. */
  disabled: boolean
  /** What its buttons do. */
  handlers: RemoteSessionRowHandlers
}

type RemoteControlStatusProps = {
  /** A running session. */
  session: RemoteSession
  /** Whose account it is: Open in Claude goes to the app here signed in as it. */
  email: string | null
}

type StopButtonProps = {
  /** The host is ending the session. */
  stopping: boolean
  /** Another session is being changed. */
  disabled: boolean
  /** Asks to stop it. */
  onStop: () => void
}

type SessionMenuProps = {
  /** Another session is being changed. */
  disabled: boolean
  /** Opens the rename dialog. */
  onRename: () => void
  /** Opens the move dialog. */
  onMove: () => void
}

/**
 * A session on a host: waiting on a question, running (with where to reach
 * it), or previous (to resume).
 */
export function RemoteSessionRow({ host, session, email, home, busy, disabled, handlers }: RemoteSessionRowProps) {
  return (
    <SessionRowBase
      title={sessionTitle(session)}
      badges={<SessionBadges session={session} busy={busy} />}
      folder={session.cwd}
      home={home}
      at={session.updatedAt}
      actions={
        <SessionActions
          host={host}
          session={session}
          email={email}
          busy={busy}
          disabled={disabled}
          handlers={handlers}
        />
      }
    />
  )
}

/** Beside the title: waiting for an answer, or open, with whether it waits on a restart to update. */
function SessionBadges({ session, busy }: SessionBadgesProps) {
  if (session.waiting) {
    return (
      <span
        className="inline-flex shrink-0 items-center gap-1 text-meta text-muted-strong"
        title="Claude is asking something before it starts, such as whether to trust the folder."
      >
        <StatusDot tone="warning" />
        Waiting for you
      </span>
    )
  }
  if (!session.running) {
    return null
  }
  const stopping = busy === 'stop'
  return (
    <>
      <span className="inline-flex shrink-0 items-center gap-1 text-meta text-muted-strong">
        <StatusDot tone={stopping ? 'neutral' : 'success'} />
        {stopping ? 'Stopping…' : tmuxAttach(session) ? 'Open' : 'Open outside tmux'}
      </span>
      {session.updatePending && !stopping ? (
        <span
          className="inline-flex shrink-0 items-center gap-1 text-meta text-amber"
          title={`It runs Claude Code ${session.claudeVersion ?? 'an older version'}, and a newer one is installed on the host. Restart it to update.`}
        >
          <RotateCw aria-hidden className="h-3 w-3" />
          Restart to update
        </span>
      ) : null}
    </>
  )
}

/** The row's buttons, for where the session is. */
function SessionActions({ host, session, email, busy, disabled, handlers }: SessionActionsProps) {
  if (session.waiting) {
    return <WaitingActions busy={busy} disabled={disabled} handlers={handlers} />
  }
  if (session.running) {
    return (
      <RunningActions host={host} session={session} email={email} busy={busy} disabled={disabled} handlers={handlers} />
    )
  }
  return <PreviousActions busy={busy} disabled={disabled} handlers={handlers} />
}

/** A session waiting on a question: answer it, or stop it. */
function WaitingActions({ busy, disabled, handlers }: HeldActionsProps) {
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        leadingIcon={<MessageSquareReply className="h-3.5 w-3.5" />}
        title="See what Claude is asking, and answer it"
        disabled={disabled}
        className={rowActionClasses}
        onClick={handlers.onResume}
      >
        {busy === 'resume' ? 'Opening…' : 'Answer'}
      </Button>
      <StopButton stopping={busy === 'stop'} disabled={disabled} onStop={handlers.onStop} />
    </>
  )
}

/** A running session: where to reach it, then restart, stop and the rest. */
function RunningActions({ host, session, email, busy, disabled, handlers }: SessionActionsProps) {
  const attach = attachCommand(host, session)
  const tmux = tmuxAttach(session)
  return (
    <>
      <RemoteControlStatus session={session} email={email} />
      {attach && tmux ? (
        <Button
          variant="ghost"
          size="sm"
          aria-label="Open its window"
          title="Open its tmux window, here or in Terminal"
          onClick={handlers.onView}
        >
          <SquareTerminal aria-hidden className="h-3.5 w-3.5" />
        </Button>
      ) : null}
      <Button
        variant="ghost"
        size="sm"
        aria-label="Restart"
        title={restartTitle(session, tmux !== null)}
        disabled={disabled}
        className={cn(rowActionClasses, session.updatePending && 'text-amber hover:text-amber')}
        onClick={handlers.onRestart}
      >
        <RotateCw aria-hidden className={cn('h-3.5 w-3.5', busy === 'restart' && 'animate-spin')} />
      </Button>
      <StopButton stopping={busy === 'stop'} disabled={disabled} onStop={handlers.onStop} />
      <SessionMenu disabled={disabled} onRename={handlers.onRename} onMove={handlers.onMove} />
    </>
  )
}

/** A previous session: archive it, or resume it. */
function PreviousActions({ busy, disabled, handlers }: HeldActionsProps) {
  const resuming = busy === 'resume'
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        aria-label="Archive"
        title="Archive"
        disabled={disabled}
        className={rowActionClasses}
        onClick={handlers.onArchive}
      >
        <Archive aria-hidden className="h-3.5 w-3.5" />
      </Button>
      {/* Last, under Stop in the rows above. */}
      <Button
        variant="ghost"
        size="sm"
        aria-label={resuming ? 'Resuming' : 'Resume'}
        title={resuming ? 'Resuming…' : 'Resume'}
        disabled={disabled}
        className={rowActionClasses}
        onClick={handlers.onResume}
      >
        {resuming ? (
          <LoaderCircle aria-hidden className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Play aria-hidden className="h-3.5 w-3.5" />
        )}
      </Button>
      <SessionMenu disabled={disabled} onRename={handlers.onRename} onMove={handlers.onMove} />
    </>
  )
}

/**
 * Open in Claude once Remote Control is connected, and a spinner where it
 * will be while it connects.
 */
function RemoteControlStatus({ session, email }: RemoteControlStatusProps) {
  if (session.remoteControl && session.bridgeSessionId) {
    return <OpenInClaudeButton email={email} bridgeSessionId={session.bridgeSessionId} />
  }
  if (!session.remoteControlConnecting) {
    return null
  }
  return (
    <span
      role="status"
      aria-label="Remote Control is connecting"
      title="Remote Control is connecting. Open in Claude shows once it has."
      className="inline-flex h-7 shrink-0 items-center justify-center rounded-md border border-blue/45 bg-blue/[0.12] px-2.5 text-blue"
    >
      <LoaderCircle aria-hidden className="h-3.5 w-3.5 animate-spin" />
    </span>
  )
}

/** Stop, spinning while the host ends the session: Claude takes a few seconds to go. */
function StopButton({ stopping, disabled, onStop }: StopButtonProps) {
  return (
    <Button
      variant="ghost"
      size="sm"
      aria-label={stopping ? 'Stopping' : 'Stop'}
      title={stopping ? 'Stopping…' : 'Stop'}
      disabled={disabled}
      className={rowActionClasses}
      onClick={onStop}
    >
      {stopping ? (
        <LoaderCircle aria-hidden className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <Square aria-hidden className="h-3.5 w-3.5" />
      )}
    </Button>
  )
}

/**
 * A session's rarer actions. Renaming, and moving it to another profile: on a
 * host, switching the profile's account is the usual way to go on under
 * another account, so moving isn't a button of its own.
 */
function SessionMenu({ disabled, onRename, onMove }: SessionMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          aria-label="More for this session"
          title="Rename, or move to another profile"
          disabled={disabled}
          className={rowActionClasses}
        >
          <MoreHorizontal aria-hidden className="h-3.5 w-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem className="px-2 py-1.5 text-[12px]" onSelect={onRename}>
          Rename…
        </DropdownMenuItem>
        <DropdownMenuItem className="px-2 py-1.5 text-[12px]" onSelect={onMove}>
          Move to another profile…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
