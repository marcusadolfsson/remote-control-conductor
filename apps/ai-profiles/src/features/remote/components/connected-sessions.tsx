import type { ReactNode } from 'react'
import type { RemoteControlSession } from '../api/use-remote'

import { Radio } from 'lucide-react'

import { cn } from '@/design'
import { sessionRowClasses } from '@/features/profiles/components/session-row-base'
import { shortenHomePath } from '@/features/profiles/components/shorten-home-path'

import { byServer } from '../lib/connected'
import { folderName } from './new-remote-session-dialog'

type ConnectedSessionsProps = {
  /** The connected sessions to list. */
  sessions: Array<RemoteControlSession>
  /** A session's row. */
  row: (connected: RemoteControlSession) => ReactNode
}

/**
 * Connected sessions, the ones a Remote Control server started under that
 * server, as on a profile's page, then the rest. Goes in a list.
 */
export function ConnectedSessions({ sessions, row }: ConnectedSessionsProps) {
  return byServer(sessions).map(({ key, sessions: grouped }) => {
    const server = grouped[0]?.server
    if (key === null || !grouped[0] || !server) {
      return grouped.map(row)
    }
    const { host, account } = grouped[0]
    return (
      <li key={key} className={cn(sessionRowClasses, 'flex-col items-stretch gap-0')}>
        <div className="flex min-w-0 items-center gap-2.5">
          <Radio aria-hidden className="h-4 w-4 shrink-0 text-blue" />
          <div className="min-w-0">
            <p className="truncate text-body text-ink">{server.name ?? folderName(server.folder)}</p>
            <p className="truncate text-meta text-muted">
              {host.label}/{account} · {shortenHomePath(server.folder)}
            </p>
          </div>
        </div>
        <ul aria-label="Sessions it serves" className="mt-1.5 -mb-[8px] -mr-[13px] ml-6 border-l border-border-soft">
          {grouped.map(row)}
        </ul>
      </li>
    )
  })
}
