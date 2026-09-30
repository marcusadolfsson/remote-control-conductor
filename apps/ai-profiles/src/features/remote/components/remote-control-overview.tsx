import type { RemoteControlSession } from '../api/use-remote'

import { Laptop } from 'lucide-react'

import { PaneLayout } from '@/components/pane-layout'
import { SessionRowBase, sessionPanelClasses } from '@/features/profiles/components/session-row-base'
import { SidebarProfileRow } from '@/features/profiles/components/sidebar-profile-row'

import { useAllRemoteControlSessions } from '../api/use-remote'
import { remoteSelectionId } from '../lib/remote-selection'
import { OpenInClaudeButton } from './remote-account-detail'

/**
 * The sidebar's Remote Control entry, above the hosts: how many sessions on
 * them have Remote Control connected right now.
 */
export function RemoteControlSidebarRow({ selected, onSelect }: { selected: boolean; onSelect: () => void }) {
  const sessions = useAllRemoteControlSessions()
  // A section of its own, so the sidebar's hairlines set it apart from the
  // profiles above and the hosts below.
  return (
    <section aria-label="Remote Control" className="flex flex-col gap-px">
      <SidebarProfileRow
        name="Remote Control"
        glyph={<Laptop aria-hidden strokeWidth={1.75} className="h-3 w-3 text-blue" />}
        swatch={<span aria-hidden />}
        trailing={
          <span className="text-[10.5px] text-muted-strong" title={`${sessions.length} connected`}>
            {sessions.length}
          </span>
        }
        selected={selected}
        onSelect={onSelect}
      />
    </section>
  )
}

/** Pure: `sessions` by account, accounts in order of email, one without an email last. */
function byAccount(sessions: Array<RemoteControlSession>): Array<[string | null, Array<RemoteControlSession>]> {
  const groups = new Map<string | null, Array<RemoteControlSession>>()
  for (const connected of sessions) {
    const key = connected.email?.toLowerCase() ?? null
    groups.set(key, [...(groups.get(key) ?? []), connected])
  }
  return [...groups.entries()].sort(([a], [b]) => (a === null ? 1 : b === null ? -1 : a.localeCompare(b)))
}

/**
 * Every session on the paired hosts with Remote Control connected, by the
 * account it runs on, each ready to open in that account's Claude app. Where
 * a session is, its host and profile, is a click away.
 */
export function RemoteControlOverview({ onSelectProfile }: { onSelectProfile: (id: string) => void }) {
  const sessions = useAllRemoteControlSessions()
  const groups = byAccount(sessions)
  return (
    <PaneLayout
      header={
        <header className="border-b border-border-soft pb-6">
          <h2 className="text-[22px] font-semibold tracking-[-0.012em] text-ink">Remote Control</h2>
          <p className="mt-1 text-body text-muted">
            Sessions on your hosts with Remote Control connected, by the account they run on.
          </p>
        </header>
      }
    >
      {groups.length === 0 ? (
        <p className="text-body text-muted">No session on your hosts has Remote Control connected right now.</p>
      ) : (
        groups.map(([email, connected]) => (
          <section key={email ?? 'none'} aria-label={email ?? 'No account'} className="mb-6">
            <div className="mb-2 flex items-baseline justify-between px-0.5">
              <h3 className="text-meta font-medium text-ink-soft">{connected[0]?.email ?? 'No account on record'}</h3>
              <span className="text-meta text-muted">{connected.length}</span>
            </div>
            <div className={sessionPanelClasses}>
              <ul>
                {connected.map(({ host, account, session, email: sessionEmail }) => (
                  <SessionRowBase
                    key={`${host.id}/${account}/${session.id}`}
                    title={session.title ?? session.id}
                    badges={
                      <button
                        type="button"
                        title={`Go to ${account} on ${host.label}`}
                        className="inline-flex shrink-0 cursor-pointer items-center rounded-[5px] border border-border-soft px-1.5 py-px font-mono text-[10px] font-medium leading-[1.5] text-muted-strong hover:text-ink"
                        onClick={() => onSelectProfile(remoteSelectionId(host.id, account))}
                      >
                        {host.label}/{account}
                      </button>
                    }
                    folder={session.cwd}
                    at={session.updatedAt}
                    actions={
                      <OpenInClaudeButton email={sessionEmail} bridgeSessionId={session.bridgeSessionId ?? ''} />
                    }
                  />
                ))}
              </ul>
            </div>
          </section>
        ))
      )}
    </PaneLayout>
  )
}
