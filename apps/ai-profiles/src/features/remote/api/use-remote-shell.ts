import { useCallback, useState } from 'react'

import { isLiveRemoteSelection } from '../lib/remote-selection'
import { useCreateRemoteProfile } from './use-create-remote-profile'
import { useAdoptRemoteProfiles, useRemoteHosts, useRemoteProfiles } from './use-remote'

/**
 * What the app shell needs of the paired hosts: the hosts, which sidebar ids
 * are theirs, their profiles' ids for ⌘1…⌘9, making a profile on one, and
 * the one just made that is being signed in.
 */
export function useRemoteShell() {
  const hosts = useRemoteHosts()
  // A remote account's id is a valid selection while its host is paired, and
  // the Remote Control entry while any host is.
  const isRemoteId = useCallback((id: string) => isLiveRemoteSelection(id, hosts), [hosts])
  const profiles = useRemoteProfiles(hosts)
  useAdoptRemoteProfiles(profiles)
  const createProfile = useCreateRemoteProfile()
  const [signingIn, setSigningIn] = useState<{ hostId: string; account: string } | null>(null)
  return {
    hosts,
    isRemoteId,
    profileIds: profiles.map((profile) => profile.id),
    createProfile,
    signingIn,
    setSigningIn,
  }
}
