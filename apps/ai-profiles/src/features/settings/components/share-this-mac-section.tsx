import type { SharingCode, SharingStatus } from '@/lib/types'

import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'

import { Button, Skeleton } from '@/design'
import { sessionErrorMessage } from '@/features/profiles/components/session-error-message'
import { sharingForget, sharingNewCode, sharingSetEnabled, sharingStatus } from '@/lib/commands'
import { queryKeys } from '@/lib/query/keys'

import { CopyLine } from './remote-hosts-section'

const headingClasses = 'font-mono text-[10px] font-medium uppercase tracking-[0.1em] text-muted-strong'

/**
 * This Mac as a host: shared, another Mac's app pairs with it and manages
 * its Remote Control servers as it does a Linux host's. The app answers only
 * while it runs; the servers keep running in tmux regardless.
 */
export function ShareThisMacSection() {
  const queryClient = useQueryClient()
  const { data: status } = useSuspenseQuery({ queryKey: queryKeys.sharing, queryFn: sharingStatus })
  const update = (next: SharingStatus) => queryClient.setQueryData(queryKeys.sharing, next)
  const toggle = useMutation({ mutationFn: sharingSetEnabled, onSuccess: update })

  return (
    <section className="mb-8">
      <div className="mb-2.5 flex items-center justify-between">
        <span className={headingClasses}>Share this Mac</span>
        <Button
          size="sm"
          variant="secondary"
          disabled={toggle.isPending}
          onClick={() => toggle.mutate(!status.enabled)}
        >
          {status.enabled ? 'Stop sharing' : 'Share'}
        </Button>
      </div>
      <div className="space-y-3 rounded-xl border border-border-soft px-4 py-3.5 text-[12.5px]">
        <p className="text-muted">
          Let Remote Control Conductor on another Mac add this one as a host, to list, start, stop and show its Remote
          Control servers. It connects over Tailscale while this app is open.
        </p>
        {toggle.isError ? (
          <p role="alert" className="text-meta text-red">
            {sessionErrorMessage(toggle.error, 'It could not be changed.')}
          </p>
        ) : null}
        {status.enabled ? <SharedBody status={status} onForget={update} /> : null}
      </div>
    </section>
  )
}

/**
 * What a shared Mac shows: whether it's answering, a pairing code to make,
 * and the Macs paired with it.
 */
function SharedBody({
  status,
  onForget,
}: {
  /** The current sharing state. */
  status: SharingStatus
  /** Takes the state after a Mac is unpaired. */
  onForget: (next: SharingStatus) => void
}) {
  const code = useMutation({ mutationFn: sharingNewCode })
  const forget = useMutation({ mutationFn: sharingForget, onSuccess: onForget })
  return (
    <>
      {status.error ? (
        <p role="alert" className="text-meta text-red">
          {status.error}
        </p>
      ) : (
        <p className="text-ink-soft">Answering on port {status.port}.</p>
      )}
      <div className="space-y-1.5">
        <Button size="sm" variant="secondary" disabled={code.isPending} onClick={() => code.mutate()}>
          New pairing code
        </Button>
        {code.isError ? (
          <p role="alert" className="text-meta text-red">
            {sessionErrorMessage(code.error, 'No code could be made.')}
          </p>
        ) : null}
        {code.data ? <CodeDetails code={code.data} /> : null}
      </div>
      {status.clients.length > 0 ? (
        <ul aria-label="Paired Macs" className="space-y-1">
          {status.clients.map((client) => (
            <li key={client.id} className="flex items-center justify-between gap-2">
              <span className="text-ink-soft">{client.name}</span>
              <Button size="sm" variant="ghost" disabled={forget.isPending} onClick={() => forget.mutate(client.id)}>
                Unpair
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
    </>
  )
}

/** A pairing code, with where it points and the certificate it pins. */
function CodeDetails({ code }: { code: SharingCode }) {
  return (
    <div className="space-y-1">
      <CopyLine text={code.code} />
      <p className="text-muted">
        On the other Mac: Settings, Remote hosts, Pair a host. It works once, for ten minutes, at{' '}
        {code.hosts.join(' or ')}. Certificate {code.fingerprint}.
      </p>
    </div>
  )
}

export function ShareThisMacSectionFallback() {
  return (
    <section className="mb-8">
      <div className="mb-2.5 flex items-center justify-between">
        <span className={headingClasses}>Share this Mac</span>
        <Skeleton className="h-7 w-[64px] rounded-md" />
      </div>
      <Skeleton className="h-[72px] w-full rounded-xl" />
    </section>
  )
}
