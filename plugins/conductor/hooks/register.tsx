// Remote Control Conductor's hosts in a Claude Code pane: every host the Mac
// app paired with, its Claude accounts and their sessions. Select a session to
// resume, stop or restart it, or open it on claude.ai. `/hosts text` answers
// as text, for where nothing draws.

import type { Engine, Register } from 'claude-code'
import type { ConductorAccount, ConductorHost, ConductorNote, ConductorSession, ConductorView } from '../types'

import { atom, read, update } from 'claude-code'

import {
  addressOrder,
  claudeUrl,
  describeLaunch,
  type PairedHost,
  parseHostList,
  parseSessionKey,
  readCurl,
  runningFirst,
  sessionAction,
  sessionKey,
  summarize,
  toAccount,
  toSession,
} from './lib'

// ── The server ──
//
// Requests go to the hosts the Mac app paired with (remote-hosts.json), with
// their tokens in the Keychain.
//
// The servers have self-signed certificates, which `$.http.fetch` can't trust,
// so requests go through curl pinned to the server's public key. The key's
// hash comes from the certificate whose SHA-256 the pairing recorded, checked
// once and kept in `$.store`. The token never enters this module: a shell
// reads it from the Keychain and hands it to curl on stdin.

const KEYCHAIN_SERVICE = 'app.ai-profiles.remote-host'

/** Prints the base64 SHA-256 of the public key of the certificate at $1, if its own SHA-256 is $2. */
const PIN_SCRIPT = `
pem=$(curl -sk --max-time 5 -o /dev/null -w '%{certs}' "https://$1/v1/ping" | awk '/BEGIN CERT/{p=1} p{print} /END CERT/{exit}')
[ -n "$pem" ] || { echo "no certificate from $1" >&2; exit 2; }
fp=$(printf '%s\\n' "$pem" | openssl x509 -outform DER | shasum -a 256 | cut -c1-64)
[ "$fp" = "$2" ] || { echo "the certificate doesn't match the pairing" >&2; exit 3; }
printf '%s\\n' "$pem" | openssl x509 -pubkey -noout | openssl pkey -pubin -outform DER | openssl dgst -sha256 -binary | base64
`

/**
 * Sends $5 to URL $4 of the host whose Keychain account is $1 (service $3),
 * pinned to key $2, with JSON body $6 when there is one.
 */
const REQUEST_SCRIPT = `
token=$(security find-generic-password -s "$3" -a "$1" -w 2>/dev/null) || { echo "no token in the Keychain" >&2; exit 4; }
auth() { printf 'header = "Authorization: Bearer %s"\\n' "$token"; }
if [ -n "$6" ]; then
  auth | curl -sS -k --max-time 60 --pinnedpubkey "sha256//$2" -K - -X "$5" -H 'Content-Type: application/json' --data-binary "$6" -w '\\n%{http_code}' "$4"
else
  auth | curl -sS -k --max-time 60 --pinnedpubkey "sha256//$2" -K - -X "$5" -w '\\n%{http_code}' "$4"
fi
`

type Pins = Record<string, { fingerprint: string; key: string }>

async function sh($: Engine, script: string, args: Array<string>) {
  return $.process.run(['/bin/sh', '-c', script, 'sh', ...args], { timeoutMs: 75_000 })
}

/** The pinned key for `host`, from the store or checked now at `address`. */
async function pinFor($: Engine, host: PairedHost, address: string): Promise<string> {
  const pins = ((await $.store.get('pins')) ?? {}) as Pins
  const known = pins[host.id]
  if (known && known.fingerprint === host.fingerprint) return known.key
  const run = await sh($, PIN_SCRIPT, [address, host.fingerprint])
  if (run.exitCode !== 0) throw new Error(run.stderr.trim() || `pinning failed (${run.exitCode})`)
  const key = run.stdout.trim()
  await $.store.set('pins', { ...pins, [host.id]: { fingerprint: host.fingerprint, key } })
  return key
}

/**
 * Sends one request to `host` at `address` and resolves its JSON answer;
 * `null` when the address can't be reached.
 */
async function request(
  $: Engine,
  host: PairedHost,
  address: string,
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
): Promise<unknown | null> {
  const key = await pinFor($, host, address)
  const json = body === undefined ? '' : JSON.stringify(body)
  const url = `https://${address}${path}`
  return readCurl(await sh($, REQUEST_SCRIPT, [host.id, key, KEYCHAIN_SERVICE, url, method, json]))
}

/** The hosts the Mac app paired with. */
async function loadHosts($: Engine): Promise<Array<PairedHost>> {
  const home = await $.env.get('HOME')
  const text = await $.fs.read(`${home}/Library/Application Support/ai-profiles/remote-hosts.json`)
  return parseHostList(text)
}

type HostInfoWire = { home: string; serverVersion: string; claude?: { version?: string | null } | null }

/** The first address that answers `/v1/info`, with that answer. */
async function reach($: Engine, host: PairedHost) {
  for (const address of addressOrder(host)) {
    const info = await request($, host, address, 'GET', '/v1/info')
    if (info) return { address, info: info as HostInfoWire }
  }
  throw new Error('no address answered')
}

/** A host's accounts and sessions, or why they couldn't be read. */
async function readHost($: Engine, host: PairedHost): Promise<ConductorHost> {
  const base = { id: host.id, label: host.label, accounts: [], serverVersion: null, claudeVersion: null }
  try {
    const { address, info } = await reach($, host)
    const get = async (path: string) => (await request($, host, address, 'GET', path)) ?? []
    const wireAccounts = (await get('/v1/accounts')) as Array<Parameters<typeof toAccount>[0]>
    const accounts: Array<ConductorAccount> = await Promise.all(
      wireAccounts.map(async (account) => {
        const path = `/v1/accounts/${encodeURIComponent(account.name)}/sessions`
        const sessions = (await get(path)) as Array<Parameters<typeof toSession>[0]>
        return toAccount(account, runningFirst(sessions.map((s) => toSession(s, info.home))))
      }),
    )
    return {
      ...base,
      address,
      serverVersion: info.serverVersion,
      claudeVersion: info.claude?.version?.replace(/ \(Claude Code\)$/, '') ?? null,
      accounts,
      error: null,
    }
  } catch (err) {
    return { ...base, address: null, error: err instanceof Error ? err.message : String(err) }
  }
}

// ── The pane ──

const PANE = 'conductor-hosts'
const REFRESH_MS = 60_000
const CONFIRM_MS = 5_000

const view = atom(
  { plugin: 'conductor', key: 'view' } as const,
  {
    isLoading: false,
    hosts: [],
    updatedAt: null,
    error: null,
  } as ConductorView,
)
const selected = atom({ plugin: 'conductor', key: 'selected' } as const, null as string | null)
const confirming = atom({ plugin: 'conductor', key: 'confirming' } as const, null as string | null)
const busy = atom({ plugin: 'conductor', key: 'busy' } as const, null as string | null)
const note = atom({ plugin: 'conductor', key: 'note' } as const, null as ConductorNote | null)

type Action = 'resume' | 'stop' | 'restart' | 'open'

/** What each action is called on its button and while it runs. */
const ACTIONS: Record<Action, { label: string; confirm?: string; running: string; hotkey: string }> = {
  resume: { label: 'Resume', running: 'resuming…', hotkey: 'u' },
  stop: { label: 'Stop', confirm: 'Confirm stop', running: 'stopping…', hotkey: 's' },
  restart: { label: 'Restart', confirm: 'Confirm restart', running: 'restarting…', hotkey: 't' },
  open: { label: 'Open on claude.ai', running: 'opening…', hotkey: 'o' },
}

let refreshing: Promise<void> | null = null
let isWatching = false

/** Reads every paired host again; one refresh at a time. */
function refresh($: Engine): Promise<void> {
  refreshing ??= (async () => {
    await update($, view, (current) => ({ ...current, isLoading: true }))
    try {
      const hosts = await Promise.all((await loadHosts($)).map((host) => readHost($, host)))
      const updatedAt = await $.clock.now()
      await update($, view, () => ({ isLoading: false, hosts, updatedAt, error: null }))
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      await update($, view, (current) => ({ ...current, isLoading: false, error }))
    }
  })().finally(() => {
    refreshing = null
  })
  return refreshing
}

function findSession(current: ConductorView, key: string) {
  const { hostId, account, sessionId } = parseSessionKey(key)
  const host = current.hosts.find((h) => h.id === hostId)
  const session = host?.accounts.find((a) => a.name === account)?.sessions.find((s) => s.id === sessionId)
  return host && session ? { host, account, session } : null
}

/** Stop and restart interrupt work, so the first press only asks for a second. */
async function needsConfirming($: Engine, token: string, action: Action): Promise<boolean> {
  if (!ACTIONS[action].confirm || (await read($, confirming)) === token) return false
  await update($, confirming, () => token)
  $.clock.after(CONFIRM_MS, () => void update($, confirming, (held) => (held === token ? null : held)))
  return true
}

async function runOnHost($: Engine, key: string, action: Exclude<Action, 'open'>, title: string) {
  const found = findSession(await read($, view), key)
  const paired = (await loadHosts($)).find((h) => h.id === found?.host.id)
  if (!found?.host.address || !paired) throw new Error("That host isn't reachable right now.")
  const { path, body } = sessionAction(found.account, found.session.id, action)
  const answer = (await request($, paired, found.host.address, 'POST', path, body)) ?? {}
  if (action === 'stop') return `${title} stopped.`
  return describeLaunch(action, title, answer as Parameters<typeof describeLaunch>[2])
}

async function openOnClaude($: Engine, session: ConductorSession) {
  const url = claudeUrl(session)
  if (!url) throw new Error('That session has no claude.ai link: Remote Control is off.')
  const run = await $.process.run(['/usr/bin/open', url])
  if (run.exitCode !== 0) throw new Error(run.stderr.trim() || 'open failed')
  return `Opened ${session.title} on claude.ai.`
}

async function act($: Engine, key: string, action: Action) {
  const token = `${key}:${action}`
  if ((await read($, busy)) || (await needsConfirming($, token, action))) return
  const found = findSession(await read($, view), key)
  if (!found) return
  await update($, confirming, () => null)
  await update($, busy, () => token)
  await update($, note, () => null)
  try {
    const text =
      action === 'open' ? await openOnClaude($, found.session) : await runOnHost($, key, action, found.session.title)
    await update($, note, () => ({ text, isError: false }))
  } catch (err) {
    await update($, note, () => ({ text: err instanceof Error ? err.message : String(err), isError: true }))
  } finally {
    await update($, busy, () => null)
  }
  if (action !== 'open') void refresh($)
}

function age(updatedAt: number | null, now: number): string {
  if (updatedAt === null) return 'not read yet'
  const seconds = Math.round((now - updatedAt) / 1000)
  return seconds < 5 ? 'just now' : `${seconds}s ago`
}

function dotColor(session: ConductorSession): string | undefined {
  if (!session.running) return
  return session.waiting ? 'yellow' : 'green'
}

export const register: Register = (on) => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'hosts',
      description: "Show Remote Control Conductor's hosts and their sessions in a pane",
    })
    return next(e)
  })

  on('command.run', { command: 'hosts' }, async ($, e) => {
    if (e.args.trim() === 'text') {
      await refresh($)
      return { text: summarize(await read($, view)) }
    }
    await $.ui.open({ id: PANE, title: 'Hosts' })
    if (!isWatching) {
      isWatching = true
      $.clock.every(REFRESH_MS, () => void refresh($))
    }
    void refresh($)
    return { text: 'Hosts pane opened.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const current = await read($, view)
    const chosen = await read($, selected)
    const asking = await read($, confirming)
    const running = await read($, busy)
    const said = await read($, note)
    const now = await $.clock.now()

    const actionsFor = (key: string, session: ConductorSession) => {
      const offered: Array<Action> = session.running ? ['stop', 'restart'] : ['resume']
      if (session.bridgeSessionId) offered.push('open')
      return (
        <Box marginLeft={6}>
          {offered.map((action) => {
            const token = `${key}:${action}`
            if (running === token) return <Text dimColor>{ACTIONS[action].running} </Text>
            const isAsking = asking === token
            return (
              <Button
                key={`a-${action}`}
                label={isAsking ? (ACTIONS[action].confirm ?? '') : ACTIONS[action].label}
                hotkey={ACTIONS[action].hotkey}
                variant={isAsking ? 'primary' : undefined}
                onPress={() => void act($, key, action)}
              />
            )
          })}
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        <Box>
          <Button key="refresh" label="Refresh" hotkey="r" onPress={() => void refresh($)} />
          <Text dimColor> {current.isLoading ? 'reading…' : age(current.updatedAt, now)}</Text>
        </Box>
        {said && <Text color={said.isError ? 'red' : 'green'}>{said.text}</Text>}
        {current.error && <Text color="red">{current.error}</Text>}
        {current.hosts.map((host) => (
          <Box flexDirection="column" marginTop={1}>
            <Text>
              <Text bold>{host.label}</Text>
              <Text dimColor>
                {host.serverVersion ? `  server ${host.serverVersion}` : ''}
                {host.claudeVersion ? ` · claude ${host.claudeVersion}` : ''}
              </Text>
            </Text>
            {host.error && <Text color="red"> {host.error}</Text>}
            {host.accounts.map((account) => (
              <Box flexDirection="column">
                <Text>
                  {'  '}
                  {account.name}
                  <Text dimColor>
                    {account.email ? `  ${account.email}` : ''}
                    {account.signedIn ? '' : '  signed out'}
                  </Text>
                </Text>
                {account.sessions.map((session) => {
                  const key = sessionKey(host.id, account.name, session.id)
                  const isChosen = chosen === key
                  return (
                    <Box flexDirection="column">
                      <Box>
                        <Text>{'    '}</Text>
                        <Text color={dotColor(session)} dimColor={!session.running}>
                          {session.running ? '●' : '○'}{' '}
                        </Text>
                        <Button
                          key={`s-${session.id}`}
                          plain
                          label={isChosen ? `▸ ${session.title}` : session.title}
                          onPress={() => void update($, selected, (was) => (was === key ? null : key))}
                        />
                        <Text dimColor wrap="truncate-end">
                          {session.cwd ? `  ${session.cwd}` : ''}
                          {session.updatePending ? '  update pending' : ''}
                        </Text>
                      </Box>
                      {isChosen && actionsFor(key, session)}
                    </Box>
                  )
                })}
              </Box>
            ))}
          </Box>
        ))}
      </Box>
    )
  })
}
