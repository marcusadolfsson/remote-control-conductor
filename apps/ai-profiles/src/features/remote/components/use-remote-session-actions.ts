import type { RemoteArchivedSession, RemoteHost, RemoteLaunch, RemoteSession, RemoteTransferReport } from '@/lib/types'
import type { Pending } from '../lib/confirm-end'
import type { RestartProgress } from '../lib/session-labels'

import { useState } from 'react'

import { useToast } from '@/design'
import { sessionErrorMessage } from '@/features/profiles/components/session-error-message'
import { formatBytes } from '@/lib/format-bytes'

import {
  useArchiveRemoteSession,
  useDeleteRemoteArchive,
  useRestartRemoteSession,
  useRestoreRemoteSession,
  useResumeRemoteSession,
  useStopRemoteSession,
} from '../api/use-remote'
import { sessionTitle } from '../lib/session-labels'
import { movedDetails, restartAllSummary } from '../lib/session-outcomes'

/** What a row can be busy with, while the host does it. */
export type BusyAction = 'resume' | 'restart' | 'stop' | 'archive' | 'restore' | 'delete'

/** What a row is busy with. */
type Busy = { id: string; action: BusyAction }

/**
 * A start or resume worth showing more about than a toast, and the profile
 * it runs under when that isn't this one (after a move).
 */
type OnResult = (launch: RemoteLaunch, account?: string) => void

/** What the profile's sessions can have done to them, and what's under way. */
export type RemoteSessionActions = ReturnType<typeof useRemoteSessionActions>

/**
 * What can be done to a profile's sessions on a host, one at a time, each
 * saying in a toast how it went; with what's under way meanwhile, so the
 * rows can say so and hold their other actions.
 */
export function useRemoteSessionActions(host: RemoteHost, account: string, onResult: OnResult) {
  const resume = useResumeRemoteSession(host.id, account)
  const restart = useRestartRemoteSession(host.id, account)
  const stop = useStopRemoteSession(host.id, account)
  const archive = useArchiveRemoteSession(host.id, account)
  const restore = useRestoreRemoteSession(host.id, account)
  const deleteArchive = useDeleteRemoteArchive(host.id, account)
  const toast = useToast()
  const [busy, setBusy] = useState<Busy | null>(null)
  const [restartingAll, setRestartingAll] = useState<RestartProgress | null>(null)

  /** Marks the row busy while `work` runs, and says so when it fails. */
  async function track(id: string, action: BusyAction, failure: string, work: () => Promise<void>) {
    setBusy({ id, action })
    try {
      await work()
    } catch (caught) {
      toast.error(failure, sessionErrorMessage(caught))
    } finally {
      setBusy(null)
    }
  }

  function handleResume(session: RemoteSession) {
    return track(session.id, 'resume', 'Could not resume it.', async () => {
      const launch = await resume.mutateAsync(session.id)
      if (launch.attention || launch.alreadyRunning) {
        onResult(launch)
      } else {
        toast.success(`Resumed on ${host.label}`, `In tmux window ${launch.window.windowId}, with Remote Control on.`)
      }
    })
  }

  function handleRestart(session: RemoteSession) {
    return track(session.id, 'restart', 'Could not restart it.', async () => {
      const launch = await restart.mutateAsync(session.id)
      if (launch.attention) {
        onResult(launch)
      } else {
        toast.success(
          `Restarted on ${host.label}`,
          `In tmux window ${launch.window.windowId}, on the host's current claude.`,
        )
      }
    })
  }

  function handleStop(session: RemoteSession) {
    return track(session.id, 'stop', 'Could not stop it.', async () => {
      await stop.mutateAsync(session.id)
      toast.success('Stopped', sessionTitle(session))
    })
  }

  function handleArchive(session: RemoteSession) {
    return track(session.id, 'archive', 'Could not archive it.', async () => {
      await archive.mutateAsync(session.id)
      toast.success('Archived', sessionTitle(session))
    })
  }

  function handleRestore(archived: RemoteArchivedSession) {
    return track(archived.id, 'restore', 'Could not restore it.', async () => {
      await restore.mutateAsync({ sessionId: archived.id, archive: archived.archive })
      toast.success('Restored', archived.title ?? archived.id)
    })
  }

  function handleDeleteArchive(archived: RemoteArchivedSession) {
    return track(archived.id, 'delete', 'Could not delete it.', async () => {
      const freed = await deleteArchive.mutateAsync({ sessionId: archived.id, archive: archived.archive })
      toast.success(`Deleted, freeing ${formatBytes(freed)}`, archived.title ?? archived.id)
    })
  }

  /** One at a time: each is a stop and a start on the host. */
  async function handleRestartAll(targets: Array<RemoteSession>) {
    const failed: Array<string> = []
    let waiting = 0
    setRestartingAll({ done: 0, total: targets.length })
    for (const [index, session] of targets.entries()) {
      try {
        const launch = await restart.mutateAsync(session.id)
        if (launch.attention) {
          waiting += 1
        }
      } catch (caught) {
        failed.push(`${session.title ?? session.id}: ${sessionErrorMessage(caught)}`)
      }
      setRestartingAll({ done: index + 1, total: targets.length })
    }
    setRestartingAll(null)
    const summary = restartAllSummary(targets.length, failed, waiting, host.label)
    if (summary.ok) {
      toast.success(summary.title, summary.detail)
    } else {
      toast.error(summary.title, summary.detail)
    }
  }

  function handleMoved(report: RemoteTransferReport, to: string) {
    if (report.deleteError) {
      toast.error(`Moved to ${to}. The session on ${account} was kept.`, report.deleteError)
    }
    if (report.resumeError) {
      toast.error(`Moved to ${to}, but it didn't resume.`, report.resumeError)
    } else if (report.launch?.attention) {
      onResult(report.launch, to)
    } else {
      toast.success(report.changed ? `Moved to ${to}` : `${to} was already up to date`, movedDetails(report, account))
    }
  }

  /** Does what the user confirmed. */
  function handleConfirmed(confirmed: Pending) {
    if (confirmed.kind === 'stop') {
      void handleStop(confirmed.session)
    } else if (confirmed.kind === 'archive') {
      void handleArchive(confirmed.session)
    } else {
      void handleRestartAll(confirmed.sessions)
    }
  }

  return {
    busy,
    restartingAll,
    /** Something is under way: one at a time. */
    locked: busy !== null || restartingAll !== null,
    resume: handleResume,
    restart: handleRestart,
    restore: handleRestore,
    deleteArchive: handleDeleteArchive,
    moved: handleMoved,
    confirmed: handleConfirmed,
  }
}

/** What the host is doing to a session, if anything: Restart all restarts every row. */
export function busyFor(actions: RemoteSessionActions, id: string): BusyAction | null {
  if (actions.busy?.id === id) {
    return actions.busy.action
  }
  return actions.restartingAll ? 'restart' : null
}
