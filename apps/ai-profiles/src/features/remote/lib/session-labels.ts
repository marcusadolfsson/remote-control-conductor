import type { RemoteSession } from '@/lib/types'

/** What a session is called: its title, else its last prompt, else its id. */
export function sessionTitle(session: Pick<RemoteSession, 'id' | 'title' | 'lastPrompt'>): string {
  return session.title ?? session.lastPrompt ?? session.id
}

/** A host's `%Y%m%d-%H%M%S` stamp as a time, read as this Mac's local time. */
export function stampToIso(stamp: string): string {
  const match = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})$/.exec(stamp)
  if (!match) {
    return new Date().toISOString()
  }
  const [year, month, day, hour, minute, second] = match.slice(1).map(Number)
  return new Date(year, month - 1, day, hour, minute, second).toISOString()
}

/**
 * What a running session's Restart says on hover: that it updates Claude
 * Code when a newer one is installed, and that it moves into tmux when the
 * session runs outside it.
 */
export function restartTitle(session: RemoteSession, inTmux: boolean): string {
  if (session.updatePending) {
    return `Restart to update: stop it and start it again on the newer claude installed on the host (it runs ${session.claudeVersion ?? 'an older one'})`
  }
  return inTmux
    ? "Restart: stop it and start it again on the host's current claude"
    : "Restart: stop it and start it again in tmux, on the host's current claude"
}

/** How far Restart all has got: the session it's on, of how many. */
export type RestartProgress = { done: number; total: number }

/** What Restart all says: how far it has got, or how many sessions it would update. */
export function restartAllLabel(progress: RestartProgress | null, updating: number): string {
  if (progress) {
    return `Restarting ${progress.done + 1} of ${progress.total}…`
  }
  return updating > 0 ? `Restart all · ${updating} to update` : 'Restart all'
}

/** What Restart all says on hover, with how many sessions run an older claude. */
export function restartAllTitle(updating: number): string {
  return updating > 0
    ? `Stop every running session and start it again on the host's current claude: ${updating} of them run an older one`
    : "Stop every running session and start it again on the host's current claude"
}
