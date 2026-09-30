import type { AppId, Dependencies, Surfaces } from '@/lib/types'
import type { NewRemoteProfile } from './use-new-remote-profile'

import { useState } from 'react'

import { Dialog, useToast } from '@/design'
import { presetColors } from '@/lib/colors'
import { extractErrorMessage } from '@/lib/extract-error-message'

import { createDescription, initialProfileType, localAppOf } from '../lib/new-profile-type'
import {
  availableSurfaces,
  effectiveSurfaces,
  installedAppIds,
  isProfileFormValid,
  newProfileDockIcon,
} from '../lib/profile-form'
import { DockIconConsentDialog } from './dock-icon-consent-dialog'
import { ProfileDialogFoot } from './profile-dialog-foot'
import { ProfileFormFields, type ProfileType, remoteType } from './profile-form-fields'
import { useDockIconConsent } from './use-dock-icon-consent'
import { useNewRemoteProfile } from './use-new-remote-profile'

type Props = {
  open: boolean
  dependencies: Dependencies
  /**
   * Whether the user has already confirmed they understand what a Dock icon of
   * its own involves. Until they have, the option starts off for every app and
   * turning it on explains itself first; after, it starts on for the apps where
   * that costs nothing they would notice.
   */
  dockIconAcknowledged: boolean
  submitting?: boolean
  onClose: () => void
  onAcknowledgeDockIcon: () => Promise<void>
  onCreate: (input: {
    app: AppId
    name: string
    color: string
    surfaces: Surfaces
    distinctDockIcon: boolean
  }) => Promise<void>
  /**
   * Offers a profile on a paired server too, when set.
   */
  remote?: NewRemoteProfile
}

export function CreateProfileDialog({
  open,
  dependencies,
  dockIconAcknowledged,
  submitting,
  onClose,
  onAcknowledgeDockIcon,
  onCreate,
  remote,
}: Props) {
  const toast = useToast()
  const [name, setName] = useState('')
  const [color, setColor] = useState<string>(presetColors[0])
  const [surfaces, setSurfaces] = useState<Surfaces>({ gui: true, cli: true })
  // `null` until the user has chosen, so that the app's default follows them
  // when they change the app.
  const [dockIconChoice, setDockIconChoice] = useState<boolean | null>(null)

  const installedApps = installedAppIds(dependencies)
  const defaultApp = initialProfileType(remote?.initialHostId, installedApps)
  const [app, setApp] = useState<ProfileType>(defaultApp)
  // The app on this Mac, or none for a profile on a server.
  const localApp = localAppOf(app)
  const onServer = useNewRemoteProfile(remote, app === remoteType, name, color)

  const effective = effectiveSurfaces(surfaces, availableSurfaces(dependencies, localApp))
  // No app chosen leaves no surface to have, so the form isn't valid then.
  const canSubmit = app === remoteType ? onServer.valid : isProfileFormValid(name, color, effective)

  const dockIcon = newProfileDockIcon(dockIconChoice, localApp, dockIconAcknowledged, effective.gui)
  const dockIconConsent = useDockIconConsent({
    acknowledged: dockIconAcknowledged,
    onChoose: setDockIconChoice,
    onAcknowledge: onAcknowledgeDockIcon,
  })

  async function handleSubmit() {
    if (!canSubmit || submitting) {
      return
    }
    if (app === remoteType) {
      try {
        await remote?.onCreate({ hostId: onServer.hostId, name: name.trim(), color })
        setName('')
        setColor(presetColors[0])
        setApp(defaultApp)
        onClose()
      } catch (caught) {
        toast.error('Could not create profile.', extractErrorMessage(caught))
      }
      return
    }
    // canSubmit guarantees an app on this Mac, so cast is safe
    const selectedApp = localApp as AppId
    try {
      await onCreate({
        app: selectedApp,
        name: name.trim(),
        color,
        surfaces: effective,
        distinctDockIcon: dockIcon,
      })
      setName('')
      setColor(presetColors[0])
      setSurfaces({ gui: true, cli: true })
      setDockIconChoice(null)
      setApp(defaultApp)
      onClose()
    } catch (caught) {
      toast.error('Could not create profile.', extractErrorMessage(caught))
    }
  }

  return (
    <>
      <Dialog
        open={open}
        title="New profile"
        description={createDescription(app)}
        closeOnOutsideClick={false}
        onClose={onClose}
        onSubmit={handleSubmit}
        foot={
          <ProfileDialogFoot
            canSubmit={canSubmit}
            submitting={submitting}
            submitLabel="Create profile"
            submittingLabel="Creating…"
            onCancel={onClose}
            onSubmit={handleSubmit}
          />
        }
      >
        <ProfileFormFields
          app={app}
          name={name}
          color={color}
          surfaces={surfaces}
          distinctDockIcon={dockIcon}
          dependencies={dependencies}
          installedApps={installedApps}
          onAppChange={setApp}
          remote={onServer.fields}
          onNameChange={setName}
          onColorChange={setColor}
          onSurfacesChange={setSurfaces}
          onDistinctDockIconChange={dockIconConsent.choose}
          onExplainDockIcon={dockIconConsent.explain}
        />
      </Dialog>
      {/* A sibling rather than a child, so keys pressed in it are not taken for
          keys pressed in the form underneath. */}
      <ConsentForApp app={localApp} consent={dockIconConsent} />
    </>
  )
}

/**
 * The Dock icon's explanation, or its question, for the app chosen; none
 * before one is, or for a profile on a server.
 */
function ConsentForApp({ app, consent }: { app: AppId | ''; consent: ReturnType<typeof useDockIconConsent> }) {
  if (app === '') {
    return null
  }
  return (
    <DockIconConsentDialog
      open={consent.open}
      app={app}
      onClose={consent.cancel}
      onConfirm={consent.asking ? consent.confirm : undefined}
    />
  )
}
