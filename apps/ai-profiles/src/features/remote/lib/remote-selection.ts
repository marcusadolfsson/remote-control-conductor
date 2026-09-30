/**
 * Sidebar selection ids for remote accounts: `remote:<hostId>:<account>`.
 *
 * Kept apart from local entry ids (a profile's uuid, `default:<app>`) so the
 * local machinery — ⌘1…⌘9, the command palette, the window tint — never sees
 * a remote row. Host ids are UUIDs and account names can't contain `:`, so
 * splitting on the first two colons is unambiguous.
 */
const prefix = 'remote:'

/** The sidebar's Remote Control entry: every connected session, on every host. */
export const REMOTE_CONTROL_ID = 'remote-control'

export type RemoteSelection = {
  hostId: string
  account: string
}

export function remoteSelectionId(hostId: string, account: string): string {
  return `${prefix}${hostId}:${account}`
}

export function parseRemoteSelection(id: string | null): RemoteSelection | null {
  if (id === null || !id.startsWith(prefix)) {
    return null
  }
  const rest = id.slice(prefix.length)
  const split = rest.indexOf(':')
  if (split <= 0 || split === rest.length - 1) {
    return null
  }
  return { hostId: rest.slice(0, split), account: rest.slice(split + 1) }
}

/**
 * Pure: whether `id` is a remote selection that still holds among `hosts`:
 * the Remote Control entry while any host is paired, an account while its
 * host is.
 */
export function isLiveRemoteSelection(id: string, hosts: ReadonlyArray<{ id: string }>): boolean {
  if (id === REMOTE_CONTROL_ID) {
    return hosts.length > 0
  }
  const remote = parseRemoteSelection(id)
  return remote !== null && hosts.some((host) => host.id === remote.hostId)
}
