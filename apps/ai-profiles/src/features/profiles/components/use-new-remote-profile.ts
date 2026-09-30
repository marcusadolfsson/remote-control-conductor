import type { RemoteHost } from '@/lib/types'

import { useState } from 'react'

// cross-feature: a remote profile's name has to be free on its server
import { useRemoteAccounts } from '@/features/remote/api/use-remote'
import { isValidHexColor } from '@/lib/colors'

import { isValidRemoteProfileName } from '../lib/remote-profile-name'

/**
 * Where a create dialog can make a Claude CLI Remote profile, and how.
 */
export type NewRemoteProfile = {
  /**
   * Paired servers, where a Claude CLI Remote profile can be made.
   */
  hosts: Array<RemoteHost>
  /**
   * Open on the remote type, on this server.
   */
  initialHostId?: string
  /**
   * Makes a profile on a server. Resolves once it exists there.
   */
  onCreate: (input: { hostId: string; name: string; color: string }) => Promise<void>
}

/**
 * A new profile on a server, as the create dialog fills it in: the server
 * chosen, whether another profile there has the name, and whether it can be
 * made. `active` is whether the dialog is on the remote type.
 */
export function useNewRemoteProfile(
  remote: NewRemoteProfile | undefined,
  active: boolean,
  name: string,
  color: string,
) {
  const hosts = remote?.hosts ?? []
  const [hostId, setHostId] = useState<string>(remote?.initialHostId ?? hosts[0]?.id ?? '')
  // Names on the chosen server, to say before creating that one is taken.
  const serverProfiles = useRemoteAccounts(hostId, active && hostId !== '')
  const trimmed = name.trim()
  const taken = (serverProfiles.data ?? []).some((account) => account.name.toLowerCase() === trimmed.toLowerCase())
  const valid =
    hosts.some((host) => host.id === hostId) && isValidRemoteProfileName(trimmed) && !taken && isValidHexColor(color)
  return {
    hostId,
    valid,
    /** What the form fields need to offer the remote type, when it's offered. */
    fields: remote ? { hosts, hostId, onHostChange: setHostId, taken: active && taken } : undefined,
  }
}
