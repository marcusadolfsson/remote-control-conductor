// Pure helpers: reading the app's host list and the server's answers.

import type { ConductorAccount, ConductorSession, ConductorView } from '../types'

/** A host as the Mac app keeps it in remote-hosts.json (tokens are in the Keychain). */
export type PairedHost = {
  id: string
  label: string
  addresses: Array<string>
  fingerprint: string
  lastGoodAddress?: string | null
}

/** The paired hosts in the app's remote-hosts.json, a list or `{ hosts }`. */
export function parseHostList(text: string): Array<PairedHost> {
  const parsed: unknown = JSON.parse(text)
  const list = Array.isArray(parsed) ? parsed : ((parsed as { hosts?: unknown }).hosts ?? [])
  if (!Array.isArray(list)) return []
  return list.filter(
    (host): host is PairedHost =>
      typeof host?.id === 'string' && typeof host?.fingerprint === 'string' && Array.isArray(host?.addresses),
  )
}

/** The addresses to try, the last good one first, each once. */
export function addressOrder(host: PairedHost): Array<string> {
  const first = host.lastGoodAddress ? [host.lastGoodAddress] : []
  return [...new Set([...first, ...host.addresses])]
}

/** Splits curl's output, the body then `\n<status>` from `-w`. */
export function splitStatus(stdout: string): { status: number; body: string } {
  const cut = stdout.lastIndexOf('\n')
  return {
    status: Number(stdout.slice(cut + 1)) || 0,
    body: cut < 0 ? '' : stdout.slice(0, cut),
  }
}

type WireAccount = {
  name: string
  signedIn: boolean
  account?: { email?: string | null } | null
}

type WireSession = {
  id: string
  title?: string | null
  lastPrompt?: string | null
  cwd?: string | null
  running: boolean
  waiting?: boolean
  remoteControl: boolean
  updatePending?: boolean
  bridgeSessionId?: string | null
}

/** A server account as the pane shows it. */
export function toAccount(wire: WireAccount, sessions: Array<ConductorSession>): ConductorAccount {
  return {
    name: wire.name,
    email: wire.account?.email ?? null,
    signedIn: wire.signedIn,
    sessions,
  }
}

/** A server session as the pane shows it. */
export function toSession(wire: WireSession, home: string): ConductorSession {
  return {
    id: wire.id,
    title: wire.title || wire.lastPrompt || wire.id.slice(0, 8),
    cwd: wire.cwd ? shortenHome(wire.cwd, home) : null,
    running: wire.running,
    waiting: wire.waiting ?? false,
    remoteControl: wire.remoteControl,
    updatePending: wire.updatePending ?? false,
    bridgeSessionId: (wire.remoteControl && wire.bridgeSessionId) || null,
  }
}

/** Running sessions first, then the most recent. The server already sorts by time. */
export function runningFirst(sessions: Array<ConductorSession>): Array<ConductorSession> {
  return [...sessions.filter((s) => s.running), ...sessions.filter((s) => !s.running)]
}

/** `~/…` for a path under the host's home. */
function shortenHome(path: string, home: string): string {
  return home && path.startsWith(home) ? `~${path.slice(home.length)}` : path
}

/** The view as plain text, one line per host, account and session. */
export function summarize(view: ConductorView): string {
  if (view.error) return view.error
  return view.hosts
    .flatMap((host) => [
      `${host.label}${host.serverVersion ? ` (server ${host.serverVersion})` : ''}${host.error ? `: ${host.error}` : ''}`,
      ...host.accounts.flatMap((account) => [
        `  ${account.name}${account.email ? ` <${account.email}>` : ''}${account.signedIn ? '' : ' (signed out)'}`,
        ...account.sessions.map((s) => `    ${s.running ? '●' : '○'} ${s.title}${s.cwd ? `  ${s.cwd}` : ''}`),
      ]),
    ])
    .join('\n')
}

/** Names a session across hosts: `<host id>/<account>/<session id>`. */
export function sessionKey(hostId: string, account: string, sessionId: string): string {
  return `${hostId}/${account}/${sessionId}`
}

/** The parts of a `sessionKey`. Account names never contain `/`. */
export function parseSessionKey(key: string): { hostId: string; account: string; sessionId: string } {
  const [hostId = '', account = '', sessionId = ''] = key.split('/')
  return { hostId, account, sessionId }
}

/** The session's claude.ai link, while Remote Control is on. */
export function claudeUrl(session: ConductorSession): string | null {
  return session.bridgeSessionId ? `https://claude.ai/code/${session.bridgeSessionId}` : null
}

/** The server's `{ error: { message } }`, or the start of whatever else it said. */
export function errorMessage(status: number, body: string): string {
  try {
    const message = (JSON.parse(body) as { error?: { message?: string } }).error?.message
    if (message) return message
  } catch {
    // Not JSON: fall through to the raw text.
  }
  return `HTTP ${status}${body ? ` ${body.slice(0, 120)}` : ''}`
}

type LaunchWire = { alreadyRunning?: boolean; attention?: { kind: string } | null }

/** What a resume or restart did, in a line. */
export function describeLaunch(action: 'resume' | 'restart', title: string, wire: LaunchWire): string {
  if (wire.attention?.kind === 'trustPrompt') {
    return `${title} is waiting for its folder to be trusted: open its window on the host.`
  }
  if (wire.attention) return `${title} started, and is waiting for something on screen.`
  if (action === 'resume' && wire.alreadyRunning) return `${title} was already running.`
  return action === 'resume' ? `${title} resumed.` : `${title} restarted.`
}

/** curl's exit codes that mean "try the next address". */
const UNREACHABLE = new Set([6, 7, 28, 35, 52, 56])

/** What a run of the request script came to. */
export type CurlRun = { exitCode: number; stdout: string; stderr: string }

/**
 * The JSON a request answered, or `null` when the address couldn't be
 * reached; throws what went wrong otherwise.
 */
export function readCurl(run: CurlRun): unknown | null {
  if (UNREACHABLE.has(run.exitCode)) return null
  if (run.exitCode === 90) throw new Error("the server's key doesn't match the pairing")
  if (run.exitCode !== 0) throw new Error(run.stderr.trim() || `curl failed (${run.exitCode})`)
  const { status, body } = splitStatus(run.stdout)
  if (status < 200 || status >= 300) throw new Error(errorMessage(status, body))
  return body ? JSON.parse(body) : {}
}

/** The request that resumes, stops or restarts a session. */
export function sessionAction(
  account: string,
  sessionId: string,
  action: 'resume' | 'stop' | 'restart',
): { path: string; body: unknown } {
  return {
    path: `/v1/accounts/${encodeURIComponent(account)}/sessions/${encodeURIComponent(sessionId)}/${action}`,
    body: action === 'stop' ? undefined : { trustFolder: false },
  }
}
