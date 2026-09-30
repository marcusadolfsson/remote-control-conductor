import { useProfileAccount } from '@/features/profiles/api/use-profile-account'
import { SessionRowBase, sessionPanelClasses } from '@/features/profiles/components/session-row-base'

import { useRemoteControlSessions } from '../api/use-remote'
import { OpenInClaudeButton } from './open-in-claude-button'

/**
 * On a Claude profile on this Mac: the sessions on the paired hosts that run
 * with Remote Control under the same account, so its desktop app can open
 * them. A host profile's account can change (Switch account), so this
 * follows the account, not the profile. Nothing when there are none.
 */
export function ProfileRemoteControl({ profileId }: { profileId: string }) {
  const status = useProfileAccount(profileId)
  const email = status?.status === 'signedIn' ? (status.account.email ?? null) : null
  const sessions = useRemoteControlSessions(email)
  if (email === null || sessions.length === 0) {
    return null
  }
  return (
    <section aria-label="Remote Control" className="mb-6">
      <div className="mb-2 flex items-baseline justify-between px-0.5">
        <h2 className="text-meta font-medium text-ink-soft">Remote Control on {email}</h2>
        <span className="text-meta text-muted">{sessions.length}</span>
      </div>
      <div className={sessionPanelClasses}>
        <ul>
          {sessions.map(({ host, account, session }) => (
            <SessionRowBase
              key={`${host.id}/${account}/${session.id}`}
              title={session.title ?? session.id}
              badges={
                <span className="inline-flex shrink-0 items-center rounded-[5px] border border-border-soft px-1.5 py-px font-mono text-[10px] font-medium leading-[1.5] text-muted-strong">
                  {host.label}/{account}
                </span>
              }
              folder={session.cwd}
              home={undefined}
              at={session.updatedAt}
              actions={
                <OpenInClaudeButton
                  email={email}
                  bridgeSessionId={session.bridgeSessionId ?? ''}
                  profileId={profileId}
                />
              }
            />
          ))}
        </ul>
      </div>
    </section>
  )
}
