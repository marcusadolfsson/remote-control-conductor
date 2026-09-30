import type { RemoteSession } from '@/lib/types'

import { sessionTitle } from './session-labels'

/** Something held until the user confirms it. */
export type Pending =
  | { kind: 'stop'; session: RemoteSession }
  | { kind: 'restartAll'; sessions: Array<RemoteSession> }
  | { kind: 'archive'; session: RemoteSession }

/** What the confirmation says, and whether its button is a warning. */
type ConfirmText = {
  title: string
  description?: string
  body?: string
  /** The confirm button's label. */
  confirm?: string
  danger: boolean
}

/** What the dialog says while nothing is held. */
const closedText: ConfirmText = { title: '', danger: false }

/** Pure: what the confirmation says for each thing held for it, and nothing while none is. */
export function confirmText(pending: Pending | null, hostLabel: string): ConfirmText {
  switch (pending?.kind) {
    case 'stop':
      return {
        title: 'Stop this session?',
        description: sessionTitle(pending.session),
        body: pending.session.empty
          ? "Claude ends. Nothing has been said in it yet, so there's nothing to resume: it leaves the list."
          : 'Claude ends, and anything it is in the middle of stops with it. The conversation is kept: resume it from Previous.',
        confirm: 'Stop',
        danger: true,
      }
    case 'archive':
      return {
        title: 'Archive this session?',
        description: sessionTitle(pending.session),
        body: "Its transcript moves to session-transfer-backups, so it's no longer listed, here or in Claude's own /resume. Restore it from Archived.",
        confirm: 'Archive',
        danger: false,
      }
    case 'restartAll':
      return {
        title: `Restart ${pending.sessions.length} running sessions?`,
        description: `On ${hostLabel}.`,
        body: "Each one stops and starts again on the host's current claude, one after another, keeping its conversation. Anything they are in the middle of stops.",
        confirm: 'Restart all',
        danger: false,
      }
    default:
      return closedText
  }
}
