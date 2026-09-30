import type { RemoteHost, RemoteSession } from '@/lib/types'

import { useState } from 'react'

import { Dialog, useToast } from '@/design'
import { Input } from '@/design/ui/input'
import { ProfileDialogFoot } from '@/features/profiles/components/profile-dialog-foot'
import { sessionErrorMessage } from '@/features/profiles/components/session-error-message'
import { shortenHomePath } from '@/features/profiles/components/shorten-home-path'

import { useRenameRemoteSession } from '../api/use-remote'

type RenameRemoteSessionDialogProps = {
  /** The host the session is on. */
  host: RemoteHost
  /** The profile the session is in. */
  account: string
  /** The session to rename. */
  session: RemoteSession
  /** Closes the dialog. */
  onClose: () => void
}

/**
 * Renames a session everywhere it's called something: here, on the host,
 * and in the Claude app over Remote Control. A running one is renamed by
 * Claude, so it can come back with a suffix when another live session on
 * the host holds the name.
 */
export function RenameRemoteSessionDialog({ host, account, session, onClose }: RenameRemoteSessionDialogProps) {
  const [name, setName] = useState(session.named ? (session.title ?? '') : '')
  const rename = useRenameRemoteSession(host.id, account)
  const toast = useToast()
  const trimmed = name.trim()
  const ready = trimmed.length > 0 && trimmed.length <= 100 && !rename.isPending

  async function handleSave() {
    if (!ready) {
      return
    }
    try {
      const result = await rename.mutateAsync({ sessionId: session.id, name: trimmed })
      onClose()
      if (result.name !== trimmed) {
        toast.info(
          `Renamed to ${result.name}`,
          `Another session running on ${host.label} is called ${trimmed}, so Claude added a suffix.`,
        )
      } else {
        toast.success(
          `Renamed to ${result.name}`,
          result.live ? 'In the Claude app too.' : 'The Claude app shows it once the session is resumed.',
        )
      }
    } catch (caught) {
      toast.error('Could not rename it.', sessionErrorMessage(caught))
    }
  }

  return (
    <Dialog
      open
      title="Rename session"
      description={session.cwd ? shortenHomePath(session.cwd) : undefined}
      onClose={onClose}
      onSubmit={handleSave}
      foot={
        <ProfileDialogFoot
          canSubmit={ready}
          submitting={rename.isPending}
          submitLabel="Rename"
          submittingLabel="Renaming…"
          onCancel={onClose}
          onSubmit={handleSave}
        />
      }
    >
      <div>
        <label htmlFor="remote-session-name" className="mb-1.5 block text-meta text-ink-soft">
          Name
        </label>
        <Input
          id="remote-session-name"
          autoFocus
          value={name}
          placeholder={session.title ?? session.lastPrompt ?? undefined}
          onChange={(event) => setName(event.target.value)}
          autoComplete="off"
          spellCheck={false}
        />
        <span className="mt-1.5 block text-meta text-muted-strong">
          {session.running
            ? 'Claude takes it now, and so does the Claude app. It has to be idle, at an empty prompt.'
            : 'Written to the session now. The Claude app shows it once the session is resumed.'}
        </span>
      </div>
    </Dialog>
  )
}
