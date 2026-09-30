import type { RemoteAccount, RemoteHost } from '@/lib/types'

import { useState } from 'react'

import { cn, Dialog, useToast } from '@/design'
import { Input } from '@/design/ui/input'
import { ColorSwatchPicker } from '@/features/profiles/components/color-swatch-picker'
import { ProfileDialogFoot } from '@/features/profiles/components/profile-dialog-foot'
import { sessionErrorMessage } from '@/features/profiles/components/session-error-message'
import { remoteRename } from '@/features/profiles/lib/remote-profile-name'
import { isValidHexColor, presetColors } from '@/lib/colors'

import { useRenameRemoteProfile, useSetRemoteProfileColor } from '../api/use-remote'

type EditRemoteProfileDialogProps = {
  /** The host the profile is on. */
  host: RemoteHost
  /** The profile, once the host has listed it. */
  account: RemoteAccount | null
  /** The profile's name. */
  name: string
  /** Every profile name on the host, this one included. */
  taken: Array<string>
  /** Closes the dialog. */
  onClose: () => void
  /** It was renamed: to this. */
  onRenamed: (name: string) => void
}

type NameFieldProps = {
  /** The name typed. */
  value: string
  /** The default profile keeps its name. */
  fixed: boolean
  /** Whether it can be renamed to it, and the line under it. */
  rename: ReturnType<typeof remoteRename>
  /** How many of its sessions run, which a rename stops. */
  running: number
  /** Takes the name typed. */
  onChange: (value: string) => void
}

/**
 * A remote profile's name and color. The name is its account folder on the
 * server, so it must be one the server takes and no other profile there has
 * (ignoring case); running sessions have that folder open, so renaming stops
 * them first, which this says.
 */
export function EditRemoteProfileDialog({
  host,
  account,
  name,
  taken,
  onClose,
  onRenamed,
}: EditRemoteProfileDialogProps) {
  const color = host.profiles?.[name]?.color ?? null
  const [picked, setPicked] = useState(color ?? presetColors[0])
  const [newName, setNewName] = useState(name)
  const renameProfile = useRenameRemoteProfile(host.id)
  const save = useSetRemoteProfileColor(host.id)
  const toast = useToast()
  const running = account?.runningSessions ?? 0
  const fixed = account?.isDefault ?? false
  const rename = remoteRename({ name, newName, taken, fixed, hostLabel: host.label })
  const busy = renameProfile.isPending || save.isPending
  const ready = !busy && rename.ok && isValidHexColor(picked)

  async function handleSave() {
    if (!ready) {
      return
    }
    try {
      let current = name
      if (rename.renaming) {
        current = (
          await renameProfile.mutateAsync({ account: name, newName: rename.trimmed, stopRunning: running > 0 })
        ).name
      }
      if (picked !== color) {
        await save.mutateAsync({ account: current, color: picked })
      }
      onClose()
      if (current !== name) {
        onRenamed(current)
      }
    } catch (caught) {
      toast.error('Could not save it.', sessionErrorMessage(caught))
    }
  }

  return (
    <Dialog
      open
      title="Edit profile"
      description={`On ${host.label}.`}
      onClose={onClose}
      onSubmit={handleSave}
      foot={
        <ProfileDialogFoot
          canSubmit={ready}
          submitting={busy}
          submitLabel={rename.renaming && running > 0 ? 'Stop sessions and save' : 'Save'}
          submittingLabel="Saving…"
          onCancel={onClose}
          onSubmit={handleSave}
        />
      }
    >
      <div className="space-y-4">
        <NameField value={newName} fixed={fixed} rename={rename} running={running} onChange={setNewName} />
        <div>
          <span className="mb-1.5 block text-meta text-ink-soft">Color</span>
          <ColorSwatchPicker value={picked} onChange={setPicked} />
        </div>
      </div>
    </Dialog>
  )
}

/** The profile's name, with where it lives on the host or why it can't be used, and what a rename stops. */
function NameField({ value, fixed, rename, running, onChange }: NameFieldProps) {
  return (
    <div>
      <label htmlFor="remote-profile-name" className="mb-1.5 block text-meta text-ink-soft">
        Name
      </label>
      <Input
        id="remote-profile-name"
        autoFocus
        value={value}
        disabled={fixed}
        onChange={(event) => onChange(event.target.value)}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
      />
      <span className={cn('mt-1.5 block font-mono text-mono', rename.hint.problem ? 'text-red' : 'text-muted-strong')}>
        {rename.hint.text}
      </span>
      {rename.renaming && running > 0 && rename.ok ? (
        <span className="mt-1 block text-meta text-amber">
          {running} running {running === 1 ? 'session has' : 'sessions have'} its folder open, and{' '}
          {running === 1 ? 'stops' : 'stop'} first. Resume {running === 1 ? 'it' : 'them'} from Previous.
        </span>
      ) : null}
    </div>
  )
}
