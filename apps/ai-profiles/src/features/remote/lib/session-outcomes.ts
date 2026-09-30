import type { RemoteTransferReport } from '@/lib/types'

/** A toast's words: a title, and the line under it when there is one. */
type ToastText = { title: string; detail?: string }

/**
 * Pure: the line under "Moved to …": where it resumed, that the copy left
 * behind was deleted, and how much project memory came along. Nothing when
 * the move did none of these.
 */
export function movedDetails(report: RemoteTransferReport, from: string): string | undefined {
  const notes = report.memory.length
  const details = [
    report.launch ? `Resumed in tmux window ${report.launch.window.windowId}.` : null,
    report.freedBytes !== null ? `Deleted the copy in ${from}.` : null,
    notes > 0 ? `Project memory: ${notes} ${notes === 1 ? 'note' : 'notes'} brought over.` : null,
  ]
    .filter(Boolean)
    .join(' ')
  return details || undefined
}

/**
 * Pure: what Restart all says once it's done. Failures are listed one per
 * line; otherwise, how many restarted, and how many wait on a question in
 * their window.
 */
export function restartAllSummary(
  total: number,
  failed: Array<string>,
  waiting: number,
  hostLabel: string,
): ToastText & { ok: boolean } {
  const restarted = total - failed.length
  if (failed.length > 0) {
    return { ok: false, title: `Restarted ${restarted} of ${total}.`, detail: failed.join('\n') }
  }
  return {
    ok: true,
    title: `Restarted ${restarted} ${restarted === 1 ? 'session' : 'sessions'} on ${hostLabel}`,
    detail: waiting > 0 ? `${waiting} ${waiting === 1 ? 'is' : 'are'} waiting for you in its window.` : undefined,
  }
}
