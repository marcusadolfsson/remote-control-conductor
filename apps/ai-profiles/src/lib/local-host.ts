import type { RemoteHost } from './types'

/** The id standing for this Mac where a host's is expected. */
const LOCAL_HOST_ID = 'local'

/**
 * This Mac, as a host: its Remote Control servers run in its own tmux and
 * are started and listed by the app itself, with no server, so the hosts'
 * dialogs, lists and window view serve it as they are. Its accounts are the
 * Mac's profiles, by id.
 */
export const localHost: RemoteHost = {
  id: LOCAL_HOST_ID,
  label: 'this Mac',
  hostname: 'localhost',
  addresses: [],
  fingerprint: '',
  clientId: '',
  pairedAt: '',
  lastGoodAddress: null,
  profiles: {},
}

/** Whether `hostId` is this Mac's. */
export function isLocalHost(hostId: string): boolean {
  return hostId === LOCAL_HOST_ID
}
