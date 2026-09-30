import type { RemoteHost, RemoteSession, RemoteTransferPlan, RemoteTransferReport } from '@/lib/types'
import type { Afterwards } from './use-move-options'

import { useEffect, useState } from 'react'

import { Check, LoaderCircle } from 'lucide-react'

import { cn, Dialog } from '@/design'
import { ProfileDialogFoot } from '@/features/profiles/components/profile-dialog-foot'
import { type MemoryChoice, memoryDecisions, ProjectMemory } from '@/features/profiles/components/project-memory'
import { sessionErrorMessage } from '@/features/profiles/components/session-error-message'
import { shortenHomePath } from '@/features/profiles/components/shorten-home-path'
import { formatBytes } from '@/lib/format-bytes'

import { useRemoteMergeMemory, useRemoteMoveProgress, useRemoteTransfer } from '../api/use-remote'
import { sessionTitle } from '../lib/session-labels'
import { useMoveDestination } from './use-move-destination'
import { useMoveOptions } from './use-move-options'

type Props = {
  open: boolean
  host: RemoteHost
  /** The account the session is in. */
  account: string
  session: RemoteSession
  onClose: () => void
  /** The move is done; what it did. */
  onMoved: (report: RemoteTransferReport, to: string) => void
}

type MoveFormProps = {
  /** The host the session is on. */
  host: RemoteHost
  /** The account the session is in. */
  account: string
  /** The session to move. */
  session: RemoteSession
  /** Where it can go, where it's going, and the plan for that. */
  destination: ReturnType<typeof useMoveDestination>
  /** What the user decided on the way. */
  options: ReturnType<typeof useMoveOptions>
  /** Takes another destination. */
  onPick: (name: string) => void
  /** Why the last try failed, if it did. */
  moveError: string | null
}

type DestinationSelectProps = {
  /** The host's other profiles. */
  destinations: Array<string>
  /** The one picked. */
  to: string | null
  /** Takes another. */
  onPick: (name: string) => void
}

type PlanStatusProps = {
  /** The host's plan for the move, as it's read. */
  plan: ReturnType<typeof useMoveDestination>['plan']
  /** The host the session is on. */
  hostId: string
  /** The account the session is in. */
  account: string
  /** What the user decided on the way. */
  options: ReturnType<typeof useMoveOptions>
}

/**
 * Moves a session to another profile on its host, the way claudemulti's
 * transfer does: everything under the session's id goes, project memory is
 * merged, and whatever it replaces is backed up. The plan is read from the
 * host as the destination changes, and the dialog asks what claudemulti asks
 * on the way: whether to roll back
 * a newer copy, and what to keep of a memory note both sides changed.
 */
export function MoveRemoteSessionDialog({ open, host, account, session, onClose, onMoved }: Props) {
  const destination = useMoveDestination(host.id, account, session.id)
  const options = useMoveOptions()
  const move = useRemoteTransfer(host.id, account)
  const [moveError, setMoveError] = useState<string | null>(null)
  // The move's id on the host while it runs, to show how far it has got.
  const [progressId, setProgressId] = useState<string | null>(null)
  const { to, plan } = destination
  const data = plan.data
  // The session running is dealt with by exiting it first.
  const running = data?.running.some((found) => found.exact) ?? false
  const ready = data !== undefined && to !== null && (!data.destinationNewer || options.replaceNewer) && !move.isPending

  function pickDestination(name: string) {
    destination.pick(name)
    options.reset()
    setMoveError(null)
  }

  async function handleMove() {
    if (!ready || !data || to === null) {
      return
    }
    setMoveError(null)
    const id = crypto.randomUUID()
    setProgressId(id)
    try {
      const report = await move.mutateAsync({
        sessionId: session.id,
        request: {
          to,
          stopFirst: running,
          confirmRunning: false,
          replaceNewer: options.replaceNewer,
          archiveSource: options.afterwards === 'archive',
          deleteSource: options.afterwards === 'delete',
          resume: options.resume,
          trustFolder: true,
          memory: memoryDecisions(data.memory, options.choices),
          progressId: id,
        },
      })
      onMoved(report, to)
      onClose()
    } catch (caught) {
      setMoveError(sessionErrorMessage(caught, 'The session could not be moved.'))
      await plan.refetch()
    } finally {
      setProgressId(null)
    }
  }

  return (
    <Dialog
      open={open}
      title="Move to another profile"
      description={sessionTitle(session)}
      className="w-[min(680px,calc(100%-64px))]"
      onClose={onClose}
      onSubmit={handleMove}
      closeOnOutsideClick={false}
      foot={
        <ProfileDialogFoot
          canSubmit={ready}
          submitting={move.isPending}
          submitLabel={running ? 'Exit and move' : 'Move'}
          submittingLabel={running ? 'Exiting and moving…' : 'Moving…'}
          onCancel={onClose}
          onSubmit={handleMove}
        />
      }
    >
      {move.isPending ? (
        <MoveProgressSteps hostId={host.id} progressId={progressId} />
      ) : (
        <MoveForm
          host={host}
          account={account}
          session={session}
          destination={destination}
          options={options}
          onPick={pickDestination}
          moveError={moveError}
        />
      )}
    </Dialog>
  )
}

/**
 * Where to move it, what that takes, and what becomes of the copy left
 * behind; or that the host has no other profile.
 */
function MoveForm({ host, account, session, destination, options, onPick, moveError }: MoveFormProps) {
  const { destinations, to, plan } = destination
  if (destinations.length === 0) {
    return <p className="text-body text-ink-soft">{host.label} has no other profile to move it to.</p>
  }
  return (
    <div className="space-y-3">
      {session.cwd ? <p className="font-mono text-mono text-muted-strong">{shortenHomePath(session.cwd)}</p> : null}
      <DestinationSelect destinations={destinations} to={to} onPick={onPick} />
      <PlanStatus plan={plan} hostId={host.id} account={account} options={options} />
      <AfterwardsChoice
        account={account}
        to={to}
        archiveBytes={plan.data?.archiveBytes ?? null}
        value={options.afterwards}
        onChange={options.setAfterwards}
      />
      <Checkbox
        checked={options.resume}
        onChange={options.setResume}
        label={`Resume it under ${to ?? 'the other profile'} afterwards`}
        hint="In tmux, with Remote Control on. The Claude app shows only messages from the move on."
      />
      {moveError ? (
        <p role="alert" className="text-meta text-red">
          {moveError}
        </p>
      ) : null}
    </div>
  )
}

/** The profile to move it to. */
function DestinationSelect({ destinations, to, onPick }: DestinationSelectProps) {
  return (
    <label className="flex items-center gap-2 text-body text-ink-soft">
      <span className="w-8 shrink-0">To</span>
      <select
        className="h-8 flex-1 cursor-pointer rounded-[7px] border border-border bg-white/60 px-2 text-body text-ink dark:bg-white/[0.05]"
        value={to ?? ''}
        onChange={(event) => onPick(event.target.value)}
      >
        {destinations.map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </select>
    </label>
  )
}

/** The host's plan for the move once it's read, or that it's being read, or why it can't be. */
function PlanStatus({ plan, hostId, account, options }: PlanStatusProps) {
  if (plan.isLoading) {
    return <p className="text-meta text-muted">Checking…</p>
  }
  if (plan.isError) {
    return (
      <p role="alert" className="text-meta text-red">
        {sessionErrorMessage(plan.error, 'Could not work out the move.')}
      </p>
    )
  }
  if (!plan.data) {
    return null
  }
  return (
    <PlanBody
      plan={plan.data}
      hostId={hostId}
      account={account}
      replaceNewer={options.replaceNewer}
      onReplaceNewer={options.setReplaceNewer}
      choices={options.choices}
      onChoice={options.choose}
    />
  )
}

/**
 * What a running move is doing, step by step, as the host reports it, with
 * how long it has taken so far: stopping a session and copying a long
 * conversation can take a while.
 */
function MoveProgressSteps({ hostId, progressId }: { hostId: string; progressId: string | null }) {
  const progress = useRemoteMoveProgress(hostId, progressId)
  // The last steps the host reported: it forgets them the moment the move
  // ends, just before the move's answer arrives.
  const [known, setKnown] = useState(progress.data ?? null)
  if (progress.data && progress.data !== known) {
    setKnown(progress.data)
  }
  const [seconds, setSeconds] = useState(0)
  useEffect(() => {
    const started = Date.now()
    const timer = window.setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 1000)
    return () => window.clearInterval(timer)
  }, [])

  return (
    <div role="status" aria-label="Move progress" className="space-y-2 text-body text-ink-soft">
      {known ? (
        <ol className="space-y-1.5">
          {known.steps.map((step, index) => (
            <li
              key={step}
              className={cn('flex items-center gap-2', index > known.current && 'text-muted')}
              aria-current={index === known.current ? 'step' : undefined}
            >
              {index < known.current ? (
                <Check aria-label="Done" className="h-3.5 w-3.5 text-green" />
              ) : index === known.current ? (
                <LoaderCircle aria-hidden className="h-3.5 w-3.5 animate-spin text-muted-strong" />
              ) : (
                <span aria-hidden className="h-3.5 w-3.5" />
              )}
              {step}
            </li>
          ))}
        </ol>
      ) : (
        <p className="flex items-center gap-2">
          <LoaderCircle aria-hidden className="h-3.5 w-3.5 animate-spin text-muted-strong" />
          Starting the move…
        </p>
      )}
      <p className="text-meta text-muted">
        {seconds < 5 ? ' ' : `${seconds} s so far. A long conversation takes a while to copy.`}
      </p>
    </div>
  )
}

function PlanBody({
  plan,
  hostId,
  account,
  replaceNewer,
  onReplaceNewer,
  choices,
  onChoice,
}: {
  plan: RemoteTransferPlan
  hostId: string
  account: string
  replaceNewer: boolean
  onReplaceNewer: (value: boolean) => void
  choices: Record<string, MemoryChoice>
  onChoice: (path: string, choice: MemoryChoice) => void
}) {
  const count = (action: string) => plan.items.filter((item) => item.action === action).length
  const [copy, replace, remove, same] = [count('copy'), count('replace'), count('remove'), count('same')]
  const files = [
    copy ? `${copy} to copy` : null,
    replace ? `${replace} to replace` : null,
    remove ? `${remove} left over to remove` : null,
    same ? `${same} already there` : null,
  ]
    .filter(Boolean)
    .join(', ')
  const merge = useRemoteMergeMemory(hostId, account)

  return (
    <div className="space-y-2.5 rounded-[10px] border border-border-soft bg-white/30 px-[13px] py-[10px] dark:bg-white/[0.02]">
      <p className="text-meta text-ink-soft">
        Files: {files}.{replace + remove > 0 ? ' What it replaces or removes is backed up first.' : ''}
      </p>
      {plan.running.some((found) => found.exact) ? (
        <p className="text-meta text-amber">
          It's running under {plan.running.find((found) => found.exact)?.account}. Moving exits it first, so the whole
          conversation goes and nothing writes to it meanwhile.
        </p>
      ) : null}
      {plan.destinationNewer ? (
        <label className="flex cursor-pointer items-start gap-2 text-meta text-amber">
          <input
            type="checkbox"
            checked={replaceNewer}
            onChange={(event) => onReplaceNewer(event.target.checked)}
            className="mt-[2px] h-3.5 w-3.5 cursor-pointer accent-orange"
          />
          {plan.destination} has a newer copy of this session. Replace it anyway? It's backed up first.
        </label>
      ) : null}
      <ProjectMemory
        memory={plan.memory}
        source={plan.source}
        destination={plan.destination}
        choices={choices}
        onChoice={onChoice}
        merge={(path) => merge.mutateAsync({ sessionId: plan.sessionId, to: plan.destination, path })}
      />
    </div>
  )
}

/**
 * What to do with the copy left in the account the session moves from.
 * Archiving keeps its transcript, which can be large, in the backups;
 * deleting frees that, once the moved copy is checked, and can't be undone.
 */
function AfterwardsChoice({
  account,
  to,
  archiveBytes,
  value,
  onChange,
}: {
  account: string
  /** The profile it moves to. */
  to: string | null
  /** What the archive holds before it's compressed, once the plan says. */
  archiveBytes: number | null
  value: Afterwards
  onChange: (value: Afterwards) => void
}) {
  // At most: the archive is compressed, by how much depends on the transcript.
  const size = archiveBytes === null ? null : formatBytes(archiveBytes)
  const options: Array<{ value: Afterwards; label: string; hint: string }> = [
    {
      value: 'archive',
      label: size === null ? 'Archive it' : `Archive it (up to ${size})`,
      hint: 'Only one profile lists it. Its transcript is kept in session-transfer-backups, compressed, and can be restored.',
    },
    {
      value: 'delete',
      label: 'Delete it',
      hint: `Only after the moved copy is checked to be identical, and it can't be undone. Plan files and project memory aren't deleted: other sessions in ${account} may use them, and ${to ?? 'the other profile'} has its own copies now.`,
    },
    { value: 'keep', label: 'Keep it', hint: 'Both profiles list it.' },
  ]
  return (
    <fieldset className="space-y-1.5">
      <legend className="mb-1.5 text-body text-ink-soft">The session on {account}</legend>
      {options.map((option) => (
        <label key={option.value} className="flex cursor-pointer items-start gap-2 text-body text-ink-soft">
          <input
            type="radio"
            name="afterwards"
            value={option.value}
            checked={value === option.value}
            onChange={() => onChange(option.value)}
            className="mt-[3px] h-4 w-4 cursor-pointer accent-orange"
          />
          <span>
            {option.label}
            <span className="block text-meta text-muted">{option.hint}</span>
          </span>
        </label>
      ))}
      {value === 'keep' ? (
        <p
          role="note"
          className="rounded-md border border-amber/40 bg-amber/[0.08] px-2.5 py-2 text-meta text-ink-soft"
        >
          This forks the session: two copies that go their own ways from here. Moving it back later doesn't merge them.
          If the copy it lands on has changed since, the move asks before replacing it, and backs it up in
          session-transfer-backups first.
        </p>
      ) : null}
    </fieldset>
  )
}

function Checkbox({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean
  onChange: (value: boolean) => void
  label: string
  hint?: string
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2 text-body text-ink-soft">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-[3px] h-4 w-4 cursor-pointer accent-orange"
      />
      <span>
        {label}
        {hint ? <span className="block text-meta text-muted">{hint}</span> : null}
      </span>
    </label>
  )
}
