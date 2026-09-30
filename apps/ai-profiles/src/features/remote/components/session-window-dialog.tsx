import type { RemoteHost, RemoteSession } from '@/lib/types'

import { useState } from 'react'

import { Copy, SquareTerminal } from 'lucide-react'

import { Button, Dialog, useToast } from '@/design'
import { sessionErrorMessage } from '@/features/profiles/components/session-error-message'
import { copyToClipboard, remoteOpenInTerminal } from '@/lib/commands'

import { sessionTitle } from '../lib/session-labels'
import { attachCommand, tmuxAttach } from '../lib/tmux-attach'
import { RemoteWindow } from './remote-window'

type SessionWindowDialogProps = {
  /** The host the session runs on. */
  host: RemoteHost
  /** The profile it runs under. */
  account: string
  /** A running session, in a tmux window. */
  session: RemoteSession
  /** The server opened the window, so it can be shown here. */
  ours: boolean
  /** Closes the dialog. */
  onClose: () => void
}

type CopyAttachButtonProps = {
  /** What to paste in a terminal to be in the window, or null when the host's names aren't plain. */
  attach: string | null
}

type NotOursNoteProps = {
  /** The tmux session the window is in. */
  tmuxSession: string
}

/**
 * Open session's tmux window in Terminal, attached over ssh. The command is
 * copied as well, for a terminal other than Terminal, or another Mac.
 */
async function openInTerminal(host: RemoteHost, session: RemoteSession, toast: ReturnType<typeof useToast>) {
  const attach = attachCommand(host, session)
  const tmux = tmuxAttach(session)
  if (!attach || !tmux) {
    return
  }
  await copyToClipboard(attach)
  try {
    const hint = await remoteOpenInTerminal({ hostId: host.id, attachCommand: tmux })
    if (hint) {
      toast.info('Opening Terminal', hint)
    }
  } catch (caught) {
    toast.error('Could not open Terminal.', `${sessionErrorMessage(caught)} The attach command is on the clipboard.`)
  }
}

/**
 * A running session's tmux window, live, in ai-profiles: what it shows, and
 * what's typed into it goes there. A window the server didn't open (one
 * started in a tmux session of the user's own) can't be shown: the server
 * only reads and types into windows it opened, where it knows keys reach
 * Claude and not a shell. Terminal, or the attach command, reach either.
 */
export function SessionWindowDialog({ host, account, session, ours, onClose }: SessionWindowDialogProps) {
  const toast = useToast()
  if (!session.window) {
    return null
  }
  return (
    <Dialog
      open
      title={sessionTitle(session)}
      description={`tmux window ${session.window.windowId} of session "${session.window.session}" on ${host.label}.`}
      className="w-[min(920px,calc(100%-64px))]"
      closeOnOutsideClick={false}
      onClose={onClose}
      foot={
        <>
          <CopyAttachButton attach={attachCommand(host, session)} />
          <Button
            variant="ghost"
            size="sm"
            leadingIcon={<SquareTerminal className="h-3.5 w-3.5" />}
            onClick={() => void openInTerminal(host, session, toast)}
          >
            Open in Terminal
          </Button>
          <Button variant="primary" size="sm" onClick={onClose}>
            Close
          </Button>
        </>
      }
    >
      {ours ? (
        <RemoteWindow host={host} account={account} windowId={session.window.windowId} />
      ) : (
        <NotOursNote tmuxSession={session.window.session} />
      )}
    </Dialog>
  )
}

/** Copies the attach command, and says so; nothing when there's none to copy. */
function CopyAttachButton({ attach }: CopyAttachButtonProps) {
  const [copied, setCopied] = useState(false)
  if (!attach) {
    return null
  }
  return (
    <Button
      variant="ghost"
      size="sm"
      leadingIcon={<Copy className="h-3.5 w-3.5" />}
      title={attach}
      onClick={async () => {
        await copyToClipboard(attach)
        setCopied(true)
      }}
    >
      {copied ? 'Copied' : 'Copy attach command'}
    </Button>
  )
}

/** Why a window in a tmux session of the user's own isn't shown here. */
function NotOursNote({ tmuxSession }: NotOursNoteProps) {
  return (
    <div
      role="alert"
      className="rounded-md border border-border-soft bg-white/40 px-3 py-6 text-center text-body text-ink-soft dark:bg-white/[0.03]"
    >
      <p>This window can't be shown here.</p>
      <p className="mt-1 text-meta text-muted">
        It's in tmux session "{tmuxSession}", which Remote Control Conductor didn't start. Remote Control Conductor only
        shows and types into windows it opened, where it knows the keys reach Claude and not a shell. Open it in
        Terminal, or copy the attach command.
      </p>
    </div>
  )
}
