import type { ProfileEditInput } from '@/features/profiles/lib/plan-profile-edit'
import type { Profile, RemoteHost } from '@/lib/types'

import { useState } from 'react'

import { useDependencies } from '@/features/dependencies/api/use-dependencies'
import { useProfiles } from '@/features/profiles/api/use-profiles'
import { planProfileEdit } from '@/features/profiles/lib/plan-profile-edit'
import { useAppState } from '@/lib/app-state/use-app-state'

import { CreateProfileDialog } from './create-profile-dialog'
import { DeleteProfileDialog } from './delete-profile-dialog'
import { EditProfileDialog } from './edit-profile-dialog'

type Props = {
  /**
   * Whether the create dialog is open.
   */
  createOpen: boolean
  /**
   * Whether the edit dialog is open.
   */
  editOpen: boolean
  /**
   * Whether the delete dialog is open.
   */
  deleteOpen: boolean
  /**
   * The selected managed profile that edit and delete act on, or `null`.
   */
  profile: Profile | null
  /**
   * Called when any of the dialogs closes.
   */
  onClose: () => void
  /**
   * Called with the new profile's id once it is created.
   */
  onCreated: (profileId: string) => void
  /**
   * Paired servers, where the create dialog can make a Claude CLI Remote profile.
   */
  remoteHosts?: Array<RemoteHost>
  /**
   * Open the create dialog on the remote type, on this server.
   */
  initialRemoteHostId?: string
  /**
   * Makes a profile on a server. Resolves once it exists there.
   */
  onCreateRemote?: (input: { hostId: string; name: string; color: string }) => Promise<void>
}

/**
 * The create, edit and delete profile dialogs, and the saves behind them.
 * Edit and delete mount only while a managed profile is selected.
 */
export function ProfileDialogs({
  createOpen,
  editOpen,
  deleteOpen,
  profile,
  onClose,
  onCreated,
  remoteHosts,
  initialRemoteHostId,
  onCreateRemote,
}: Props) {
  const profiles = useProfiles()
  const dependencies = useDependencies()
  const appState = useAppState()
  const [submitting, setSubmitting] = useState(false)
  const dockIconAcknowledged = appState.state.dockIconAcknowledgedAt !== null

  async function handleCreate(input: Parameters<typeof profiles.create>[0]) {
    setSubmitting(true)
    try {
      const created = await profiles.create(input)
      onCreated(created.id)
    } finally {
      setSubmitting(false)
    }
  }

  async function handleEdit(input: ProfileEditInput) {
    if (!profile) {
      return
    }
    setSubmitting(true)
    try {
      const plan = planProfileEdit(profile, input)
      if (plan.patch) {
        await profiles.update({ id: profile.id, patch: plan.patch })
      }
      for (const toggle of plan.toggles) {
        await profiles.toggle({ id: profile.id, ...toggle })
      }
    } finally {
      setSubmitting(false)
    }
  }

  async function handleDelete(input: { moveToTrash: boolean }) {
    if (!profile) {
      return
    }
    await profiles.remove({ id: profile.id, ...input })
  }

  async function acknowledgeDockIcon() {
    await appState.update({ dockIconAcknowledgedAt: new Date().toISOString() })
  }

  return (
    <>
      <CreateProfileDialog
        // Fresh each time it opens, so it starts on the type it was opened for.
        key={createOpen ? (initialRemoteHostId ?? 'local') : 'closed'}
        open={createOpen}
        remoteHosts={remoteHosts}
        initialRemoteHostId={initialRemoteHostId}
        onCreateRemote={onCreateRemote}
        dependencies={dependencies.deps}
        dockIconAcknowledged={dockIconAcknowledged}
        submitting={submitting}
        onClose={onClose}
        onAcknowledgeDockIcon={acknowledgeDockIcon}
        onCreate={handleCreate}
      />
      {profile ? (
        <>
          <EditProfileDialog
            open={editOpen}
            profile={profile}
            dependencies={dependencies.deps}
            dockIconAcknowledged={dockIconAcknowledged}
            submitting={submitting}
            onClose={onClose}
            onAcknowledgeDockIcon={acknowledgeDockIcon}
            onSave={handleEdit}
          />
          <DeleteProfileDialog open={deleteOpen} profile={profile} onClose={onClose} onConfirm={handleDelete} />
        </>
      ) : null}
    </>
  )
}
