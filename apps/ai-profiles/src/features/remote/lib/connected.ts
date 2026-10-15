import type { RemoteControlSession } from '../api/use-remote'

/** Connected sessions one Remote Control server started, or those none did. */
export type ConnectedGroup = {
  /** `host/account/pid`, or `null` for the sessions no listed server started. */
  key: string | null
  sessions: Array<RemoteControlSession>
}

/**
 * Pure: `sessions` by the server that started them, servers in the order
 * their first session comes, then the rest, each keeping its order.
 */
export function byServer(sessions: ReadonlyArray<RemoteControlSession>): Array<ConnectedGroup> {
  const groups = new Map<string, Array<RemoteControlSession>>()
  const rest: Array<RemoteControlSession> = []
  for (const connected of sessions) {
    if (!connected.server) {
      rest.push(connected)
      continue
    }
    const key = `${connected.host.id}/${connected.account}/${connected.server.pid}`
    groups.set(key, [...(groups.get(key) ?? []), connected])
  }
  const served = [...groups.entries()].map(([key, grouped]) => ({ key, sessions: grouped }))
  return rest.length > 0 ? [...served, { key: null, sessions: rest }] : served
}
