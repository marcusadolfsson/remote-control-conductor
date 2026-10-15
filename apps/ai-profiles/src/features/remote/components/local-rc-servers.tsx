import { useState } from 'react'

import { localHost } from '@/lib/local-host'

import { useRemoteDirs } from '../api/use-remote'
import { RcServerDialog } from './rc-server-dialog'
import { RemoteRcServers } from './remote-rc-servers'

type LocalRcServersProps = {
  /** The Claude profile on this Mac they run as. */
  profileId: string
}

/**
 * On a Claude profile on this Mac: its Remote Control servers
 * (`claude remote-control` in a folder, in tmux), so the Claude apps on other
 * devices can start sessions there, and Start… for another. The app runs
 * them itself, as the profile, in as many folders as wanted.
 */
export function LocalRcServers({ profileId }: LocalRcServersProps) {
  const [starting, setStarting] = useState(false)
  const home = useRemoteDirs(localHost.id, null, true).data?.home
  return (
    <>
      <RemoteRcServers host={localHost} account={profileId} home={home} onStart={() => setStarting(true)} />
      <RcServerDialog
        open={starting}
        host={localHost}
        account={profileId}
        initialFolder={null}
        recentFolders={[]}
        onClose={() => setStarting(false)}
      />
    </>
  )
}
