import type { RemoteHost, RemoteSession } from '@/lib/types'

/** A host name ssh takes as one plain word. */
const PLAIN_HOSTNAME = /^(?![-.])[A-Za-z0-9.-]{1,253}$/
/** Exactly what the server sends, from plain names and a window id only. */
const PLAIN_TMUX_ATTACH = /^tmux (-L [A-Za-z0-9_-]{1,64} )?attach -t [A-Za-z0-9_-]{1,64} \\; select-window -t @\d{1,9}$/

/**
 * `ssh -t <host> '<attach command>'`, to paste into a terminal on the Mac, or
 * null when either part is more than a plain name: both come from the host,
 * and whatever is copied here may be pasted into a shell. The same check as
 * Terminal's, in Rust.
 */
export function sshAttach(host: RemoteHost, attachCommand: string): string | null {
  if (!PLAIN_HOSTNAME.test(host.hostname) || !PLAIN_TMUX_ATTACH.test(attachCommand)) {
    return null
  }
  return `ssh -t ${host.hostname} '${attachCommand}'`
}

/** The part that runs on the host: attach to the tmux session, then pick the window. */
export function tmuxAttach(session: RemoteSession): string | null {
  return session.window
    ? `tmux attach -t ${session.window.session} \\; select-window -t ${session.window.windowId}`
    : null
}

/**
 * What to paste in a terminal to be in a session's tmux window: attach to
 * its tmux session over ssh, then switch to its window.
 */
export function attachCommand(host: RemoteHost, session: RemoteSession): string | null {
  const tmux = tmuxAttach(session)
  return tmux ? sshAttach(host, tmux) : null
}
