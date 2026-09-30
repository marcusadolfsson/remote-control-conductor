import type { Attention, RemoteHost, RemoteLaunch, WindowScreen } from '@/lib/types'

import { useState } from 'react'

import { useQueryClient } from '@tanstack/react-query'
import { Copy, SquareTerminal } from 'lucide-react'

import { Button, Dialog, Kbd, StatusDot, useToast } from '@/design'
import { sessionErrorMessage } from '@/features/profiles/components/session-error-message'
import { copyToClipboard, remoteOpenInTerminal } from '@/lib/commands'
import { queryKeys } from '@/lib/query/keys'

import { launchTitle } from '../lib/launch-result'
import { sshAttach } from '../lib/tmux-attach'
import { RemoteWindow } from './remote-window'

type Props = {
  host: RemoteHost
  account: string
  launch: RemoteLaunch
  onClose: () => void
}

/**
 * Once Claude in a waiting window registers its session (someone answered
 * what it asked), with whether Remote Control has connected yet.
 */
type Started = { remoteControl: boolean }

/**
 * Where a session started, and anything its window is waiting on. Shown when
 * there's something to say beyond "it started": a prompt to answer (with the
 * window live, to answer it here), or it was running already.
 */
export function LaunchResultDialog({ host, account, launch, onClose }: Props) {
  const queryClient = useQueryClient()
  const [started, setStarted] = useState<Started | null>(null)
  const waiting = launch.attention !== null && started === null

  function handleScreen(screen: WindowScreen) {
    if (screen.sessionId === null || started?.remoteControl === screen.remoteControl) {
      return
    }
    setStarted({ remoteControl: screen.remoteControl })
    // It's running now (and maybe on Remote Control): show it in the lists.
    void queryClient.invalidateQueries({ queryKey: queryKeys.remote.sessions(host.id, account) })
    void queryClient.invalidateQueries({ queryKey: queryKeys.remote.accounts(host.id) })
  }

  return (
    <Dialog
      open
      title={launchTitle(waiting, launch.alreadyRunning)}
      description={`In tmux window ${launch.window.windowId} of session "${launch.window.session}" on ${host.label}.`}
      onClose={onClose}
      onSubmit={waiting ? undefined : onClose}
      closeOnOutsideClick={!launch.attention}
      className={launch.attention ? 'w-[min(680px,calc(100%-64px))]' : undefined}
      foot={<LaunchFoot waiting={waiting} onClose={onClose} />}
    >
      <div className="space-y-3 text-body text-ink-soft">
        {launch.attention ? (
          <>
            <AttentionNote attention={launch.attention} started={started} />
            <RemoteWindow host={host} account={account} windowId={launch.window.windowId} onScreen={handleScreen} />
          </>
        ) : (
          <StartedNote launch={launch} />
        )}
        <AttachCommand host={host} attachCommand={launch.attachCommand} />
      </div>
    </Dialog>
  )
}

/**
 * The dialog's buttons: a wait for Claude while its window asks something,
 * else Done.
 */
function LaunchFoot({ waiting, onClose }: { waiting: boolean; onClose: () => void }) {
  if (!waiting) {
    return (
      <Button variant="primary" size="sm" trailingKbd={<Kbd variant="onOrange">⏎</Kbd>} onClick={onClose}>
        Done
      </Button>
    )
  }
  return (
    <>
      <Button variant="ghost" size="sm" onClick={onClose}>
        Leave it waiting
      </Button>
      <Button variant="primary" size="sm" disabled>
        Waiting for Claude…
      </Button>
    </>
  )
}

/**
 * What a session that started without asking anything came to.
 */
function StartedNote({ launch }: { launch: RemoteLaunch }) {
  if (launch.alreadyRunning) {
    return <p>It was open there already, so nothing new was started.</p>
  }
  return (
    <p>
      Remote Control is on
      {launch.remoteControlName ? ` as "${launch.remoteControlName}"` : ', named after its folder'}, so it's in the
      Claude app on your other devices.
    </p>
  )
}

type AttentionNoteProps = {
  /**
   * What the window was asking when it started.
   */
  attention: Attention
  /**
   * Once Claude is running, whether Remote Control has connected.
   */
  started: Started | null
}

/**
 * What the window is asking, and how to answer it, until Claude is running.
 */
function AttentionNote({ attention, started }: AttentionNoteProps) {
  if (started) {
    return (
      <p role="status" className="flex items-center gap-2">
        <StatusDot tone="success" />
        {started.remoteControl
          ? "Claude is running, with Remote Control connected: it's in the Claude app on your other devices."
          : 'Claude is running. Remote Control is connecting…'}
      </p>
    )
  }
  if (attention.kind === 'trustPermissions') {
    return (
      <>
        <p>
          Claude is asking whether to trust the folder, and trusting it would also allow what the folder's settings
          pre-approve, so it wasn't answered for you:
        </p>
        <p className="rounded-md border border-border-soft bg-white/40 px-2.5 py-2 font-mono text-[11.5px] text-muted-strong dark:bg-white/[0.03]">
          {attention.text}
        </p>
        <p>If that's fine, choose "Yes, I trust this folder" below (↓, then ⏎). Remote Control connects then.</p>
      </>
    )
  }
  if (attention.kind === 'trustPrompt') {
    return (
      <p>
        Claude is asking whether to trust the folder. Answer it below (↓ then ⏎ trusts it); Remote Control connects
        then.
      </p>
    )
  }
  return <p>Claude hasn't finished starting. Here's its window: answer whatever it's asking.</p>
}

type AttachCommandProps = {
  /**
   * The host the window is on.
   */
  host: RemoteHost
  /**
   * The host's command for attaching to the window.
   */
  attachCommand: RemoteLaunch['attachCommand']
}

/**
 * The command that opens the window from a terminal on this Mac, to copy or
 * run in Terminal.
 */
function AttachCommand({ host, attachCommand }: AttachCommandProps) {
  const toast = useToast()
  const [copied, setCopied] = useState(false)
  const command = sshAttach(host, attachCommand)
  if (command === null) {
    return <p>The host described its window in a way this Mac won't run, so it can't be opened from here.</p>
  }
  return (
    <div className="flex items-center gap-2">
      <code
        className="min-w-0 flex-1 truncate rounded-md border border-border-soft px-2 py-1 font-mono text-[11.5px] text-muted-strong"
        title={command}
      >
        {command}
      </code>
      <Button
        variant="secondary"
        size="sm"
        leadingIcon={<Copy className="h-3.5 w-3.5" />}
        onClick={async () => {
          await copyToClipboard(command)
          setCopied(true)
        }}
      >
        {copied ? 'Copied' : 'Copy'}
      </Button>
      <Button
        variant="secondary"
        size="sm"
        leadingIcon={<SquareTerminal className="h-3.5 w-3.5" />}
        onClick={() =>
          remoteOpenInTerminal({ hostId: host.id, attachCommand }).catch((caught) =>
            toast.error('Could not open Terminal.', sessionErrorMessage(caught)),
          )
        }
      >
        Terminal
      </Button>
    </div>
  )
}
