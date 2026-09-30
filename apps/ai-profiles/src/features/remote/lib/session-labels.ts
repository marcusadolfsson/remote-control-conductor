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
 * Pure: the update a restart brings a session, as `2.1.281 → 2.1.282`, when
 * it waits on one and both versions are known.
 */
export function updateVersions(
  session: Pick<RemoteSession, 'updatePending' | 'claudeVersion' | 'installedVersion'>,
): string | null {
  if (!session.updatePending || !session.claudeVersion || !session.installedVersion) {
    return null
  }
  return `${session.claudeVersion} → ${session.installedVersion}`
}

/**
 * The newer Claude Code the sessions waiting on an update would restart on,
 * if any says.
 */
export function installedVersionOf(sessions: Array<Pick<RemoteSession, 'installedVersion'>>): string | null {
  return sessions.find((session) => session.installedVersion)?.installedVersion ?? null
}

/**
 * What a running session's Restart says on hover: that it updates Claude
 * Code when a newer one is installed, and that it moves into tmux when the
 * session runs outside it.
 */
export function restartTitle(session: RemoteSession, inTmux: boolean): string {
  if (session.updatePending) {
    const newer = session.installedVersion ? `Claude Code ${session.installedVersion}` : 'the newer claude'
    return `Restart to update: stop it and start it again on ${newer}, installed on the host (it runs ${session.claudeVersion ?? 'an older one'})`
  }
  return inTmux
    ? "Restart: stop it and start it again on the host's current claude"
    : "Restart: stop it and start it again in tmux, on the host's current claude"
}

/** How far Restart all has got: the session it's on, of how many. */
export type RestartProgress = { done: number; total: number }

/**
 * What Restart all says: how far it has got, or how many sessions it would
 * update, and to which Claude Code when `installed` says.
 */
export function restartAllLabel(
  progress: RestartProgress | null,
  updating: number,
  installed: string | null = null,
): string {
  if (progress) {
    return `Restarting ${progress.done + 1} of ${progress.total}…`
  }
  if (updating === 0) {
    return 'Restart all'
  }
  return installed ? `Restart all · ${updating} to update (${installed})` : `Restart all · ${updating} to update`
}

/** What Restart all says on hover, with how many sessions run an older claude. */
export function restartAllTitle(updating: number, installed: string | null = null): string {
  const all = "Stop every running session and start it again on the host's current claude"
  if (updating === 0) {
    return all
  }
  return `${all}: ${updating} of them run an older one${installed ? ` than ${installed}` : ''}`
}
