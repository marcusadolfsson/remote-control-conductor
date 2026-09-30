import type { RemoteArchivedSession } from '@/lib/types'
import type { RemoteSessionActions } from './use-remote-session-actions'

import { useState } from 'react'

import { ArchiveRestore, Trash2 } from 'lucide-react'

import { Button, cn, Dialog, Kbd } from '@/design'
import { SessionRowBase, sessionPanelClasses } from '@/features/profiles/components/session-row-base'
import { formatBytes } from '@/lib/format-bytes'

import { stampToIso } from '../lib/session-labels'
import { rowActionClasses } from './remote-session-row'

type RemoteArchivedSessionsProps = {
  /** The host's name, for what deleting frees. */
  hostLabel: string
  /** The host's home folder, which folders are shortened against. */
  home?: string
  /** The profile's archived sessions. */
  archived: Array<RemoteArchivedSession>
  /** Whether the list is open (Archived, under the sessions). */
  shown: boolean
  /** Restoring and deleting, and whether something else is under way. */
  actions: RemoteSessionActions
}

type ArchivedRowProps = {
  /** The archived session the row is for. */
  archived: RemoteArchivedSession
  /** The host's home folder, which folders are shortened against. */
  home?: string
  /** Restoring and deleting, and whether something else is under way. */
  actions: RemoteSessionActions
  /** Asks to delete it. */
  onDelete: () => void
}

type DeleteArchiveDialogProps = {
  /** The archive to delete. */
  archived: RemoteArchivedSession
  /** The host's name, for what deleting frees. */
  hostLabel: string
  /** Keeps it. */
  onClose: () => void
  /** Deletes it. */
  onDelete: () => void
}

/**
 * The profile's archived sessions, under Archived: each can be restored, or
 * deleted for good once asked.
 */
export function RemoteArchivedSessions({ hostLabel, home, archived, shown, actions }: RemoteArchivedSessionsProps) {
  const [deleting, setDeleting] = useState<RemoteArchivedSession | null>(null)
  return (
    <>
      {archived.length > 0 ? (
        <div>
          {shown ? (
            <div className={cn(sessionPanelClasses, 'mt-2')}>
              <ul aria-label="Archived sessions">
                {archived.map((entry) => (
                  <ArchivedRow
                    key={`${entry.id}/${entry.archive}`}
                    archived={entry}
                    home={home}
                    actions={actions}
                    onDelete={() => setDeleting(entry)}
                  />
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
      {deleting ? (
        <DeleteArchiveDialog
          archived={deleting}
          hostLabel={hostLabel}
          onClose={() => setDeleting(null)}
          onDelete={() => {
            setDeleting(null)
            void actions.deleteArchive(deleting)
          }}
        />
      ) : null}
    </>
  )
}

/** An archived session: its size, and Restore and Delete. */
function ArchivedRow({ archived, home, actions, onDelete }: ArchivedRowProps) {
  const restoring = actions.busy?.id === archived.id && actions.busy.action === 'restore'
  return (
    <SessionRowBase
      title={archived.title ?? archived.id}
      badges={<span className="shrink-0 text-meta text-muted-strong">{formatBytes(archived.sizeBytes)}</span>}
      folder={archived.cwd}
      home={home}
      at={stampToIso(archived.stamp)}
      actions={
        <>
          <Button
            variant="ghost"
            size="sm"
            leadingIcon={<ArchiveRestore className="h-3.5 w-3.5" />}
            disabled={actions.locked}
            className={rowActionClasses}
            onClick={() => void actions.restore(archived)}
          >
            {restoring ? 'Restoring…' : 'Restore'}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            aria-label="Delete"
            title={`Delete this archive for good, freeing ${formatBytes(archived.sizeBytes)}`}
            disabled={actions.locked}
            className={rowActionClasses}
            onClick={onDelete}
          >
            <Trash2 aria-hidden className="h-3.5 w-3.5" />
          </Button>
        </>
      }
    />
  )
}

/** Asks before deleting an archive, saying what that frees on the host. */
function DeleteArchiveDialog({ archived, hostLabel, onClose, onDelete }: DeleteArchiveDialogProps) {
  return (
    <Dialog
      open
      title="Delete this archive?"
      description={archived.title ?? archived.id}
      onClose={onClose}
      onSubmit={onDelete}
      foot={
        <>
          <Button variant="ghost" size="sm" trailingKbd={<Kbd>⎋</Kbd>} onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" size="sm" trailingKbd={<Kbd>⏎</Kbd>} onClick={onDelete}>
            Delete, freeing {formatBytes(archived.sizeBytes)}
          </Button>
        </>
      }
    >
      <p className="text-body text-ink-soft">
        The archived transcript goes for good, and the session can't be restored. {hostLabel} gets back{' '}
        {formatBytes(archived.sizeBytes)}.
      </p>
    </Dialog>
  )
}
