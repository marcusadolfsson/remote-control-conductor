import type { Pending } from '../lib/confirm-end'

import { Button, Dialog, Kbd } from '@/design'

import { confirmText } from '../lib/confirm-end'

type ConfirmEndDialogProps = {
  /** What's held for the user to confirm; the dialog is closed while nothing is. */
  pending: Pending | null
  /** The host's name, for Restart all. */
  hostLabel: string
  /** Drops what's held, without doing it. */
  onClose: () => void
  /** Does what was held. */
  onConfirm: (pending: Pending) => void
}

/**
 * Asks before ending running sessions: whatever Claude is in the middle of
 * stops with them. Their conversations are kept, and can be resumed.
 */
export function ConfirmEndDialog({ pending, hostLabel, onClose, onConfirm }: ConfirmEndDialogProps) {
  const text = confirmText(pending, hostLabel)
  return (
    <Dialog
      open={pending !== null}
      title={text.title}
      description={text.description}
      onClose={onClose}
      onSubmit={() => pending && onConfirm(pending)}
      foot={
        <>
          <Button variant="ghost" size="sm" trailingKbd={<Kbd>⎋</Kbd>} onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant={text.danger ? 'danger' : 'primary'}
            size="sm"
            trailingKbd={<Kbd variant={text.danger ? undefined : 'onOrange'}>⏎</Kbd>}
            onClick={() => pending && onConfirm(pending)}
          >
            {text.confirm}
          </Button>
        </>
      }
    >
      <p className="text-body text-ink-soft">{text.body}</p>
    </Dialog>
  )
}
