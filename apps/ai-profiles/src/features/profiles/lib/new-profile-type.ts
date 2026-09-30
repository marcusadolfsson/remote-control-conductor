import type { AppId } from '@/lib/app-registry'
import type { ProfileType } from '../components/profile-form-fields'

import { remoteType } from '../components/profile-form-fields'
import { preselectedApp } from './profile-form'

/**
 * Pure: the type the create dialog opens on: a profile on a server when it
 * was opened for one, else the only app installed, if just one is.
 */
export function initialProfileType(remoteHostId: string | undefined, installedApps: ReadonlyArray<AppId>): ProfileType {
  return remoteHostId === undefined ? preselectedApp(installedApps) : remoteType
}

/**
 * Pure: the app on this Mac a type means, `''` for none or a profile on a
 * server.
 */
export function localAppOf(type: ProfileType): AppId | '' {
  return type === remoteType ? '' : type
}

/**
 * Pure: what the create dialog says a profile of this type is.
 */
export function createDescription(type: ProfileType): string {
  return type === remoteType
    ? 'A profile on a server: Claude runs there, in tmux, with Remote Control, signed in as its own account.'
    : 'A profile bundles a Desktop launcher and a CLI wrapper. Pick a name and color; everything else stays isolated.'
}
