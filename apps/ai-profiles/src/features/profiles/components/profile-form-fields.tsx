import type { ReactNode } from 'react'
import type { AppId, Dependencies, RemoteHost, Surfaces } from '@/lib/types'

import { cn } from '@/design'
import { Input } from '@/design/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/design/ui/select'
import { appSpecs, shownAppIds } from '@/lib/app-registry'

import { ColorSwatchPicker } from './color-swatch-picker'
import { ProfileSurfaceFields } from './profile-surface-fields'

/** The type that makes a profile on a paired server rather than on this Mac. */
export const remoteType = 'remote'

/** An app on this Mac, a profile on a server, or not chosen yet. */
export type ProfileType = AppId | typeof remoteType | ''

/**
 * A name the server takes for a new account folder: letters, digits, `-` and
 * `_`, starting with a letter or digit, at most 64, and not `default`. Mirrors
 * `valid_new_name` in the server.
 */
export function isValidRemoteProfileName(name: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(name) && name !== 'default'
}

type Props = {
  app: ProfileType
  name: string
  color: string
  surfaces: Surfaces
  /**
   * Whether the profile gets a Dock icon of its own. Shown as it will be saved,
   * so it reads as off whenever the desktop launcher is.
   */
  distinctDockIcon: boolean
  dependencies: Dependencies
  installedApps?: ReadonlyArray<AppId>
  showSlugPreview?: boolean
  onAppChange?: (app: Exclude<ProfileType, ''>) => void
  /** Offers the remote type: the paired servers, and which is chosen. */
  remote?: {
    hosts: Array<RemoteHost>
    hostId: string
    onHostChange: (hostId: string) => void
    /** Another profile on that server has the name (ignoring case). */
    taken?: boolean
  }
  onNameChange: (name: string) => void
  onColorChange: (color: string) => void
  onSurfacesChange: (next: Surfaces) => void
  onDistinctDockIconChange: (next: boolean) => void
  /**
   * Opens the explanation of the Dock icon option, for reading.
   */
  onExplainDockIcon: () => void
}

/**
 * Mirror of `slugify` in src-tauri/src/slug.rs — kept for the live preview
 * only. The persisted slug is whatever the server returns from
 * createProfile / updateProfile.
 */
export function slugifyPreview(name: string): string {
  let result = ''
  let lastWasDash = true
  for (const character of name) {
    if (/[a-zA-Z0-9]/.test(character)) {
      result += character.toLowerCase()
      lastWasDash = false
    } else if (!lastWasDash) {
      result += '-'
      lastWasDash = true
    }
  }
  return result.replace(/-+$/, '')
}

/**
 * Shared form body for the create and edit modals.
 *
 * Layout: app-type Select, tracked-uppercase eyebrow label + name input + live
 * slug helper, color swatch row, two surface toggle cards with the Dock icon
 * option under the desktop one. Surface cards self-disable when the underlying
 * dependency is missing; the parent renders the actionable copy ("Install …
 * first") underneath if it cares.
 */
export function ProfileFormFields({
  app,
  name,
  color,
  surfaces,
  distinctDockIcon,
  dependencies,
  installedApps,
  showSlugPreview = true,
  onAppChange,
  onNameChange,
  onColorChange,
  onSurfacesChange,
  onDistinctDockIconChange,
  onExplainDockIcon,
  remote,
}: Props) {
  const typeField =
    onAppChange !== undefined && installedApps !== undefined ? (
      <AppTypeField app={app} installedApps={installedApps} remote={remote} onAppChange={onAppChange} />
    ) : null
  if (app === remoteType) {
    return remote ? (
      <RemoteFields
        name={name}
        color={color}
        remote={remote}
        typeField={typeField}
        onNameChange={onNameChange}
        onColorChange={onColorChange}
      />
    ) : null
  }
  return (
    <div className="space-y-4">
      {typeField}
      <NameField name={name} showSlugPreview={showSlugPreview} onNameChange={onNameChange} />
      <Field label="Color">
        <ColorSwatchPicker value={color} onChange={onColorChange} />
      </Field>
      <Field label="Surfaces">
        <ProfileSurfaceFields
          app={app}
          surfaces={surfaces}
          distinctDockIcon={distinctDockIcon}
          dependencies={dependencies}
          onSurfacesChange={onSurfacesChange}
          onDistinctDockIconChange={onDistinctDockIconChange}
          onExplainDockIcon={onExplainDockIcon}
        />
      </Field>
    </div>
  )
}

type AppTypeFieldProps = {
  /**
   * The chosen app (or a profile on a server), or `''` while none has been chosen.
   */
  app: ProfileType
  /**
   * The apps that can be chosen; the others are listed, disabled.
   */
  installedApps: ReadonlyArray<AppId>
  /**
   * Offers a profile on a paired server too, when set.
   */
  remote: Props['remote']
  /**
   * Takes the newly chosen type.
   */
  onAppChange: (app: Exclude<ProfileType, ''>) => void
}

/**
 * The app-type Select, for a profile whose app is still to be chosen.
 */
function AppTypeField({ app, installedApps, remote, onAppChange }: AppTypeFieldProps) {
  return (
    <Field label="Type">
      <Select value={app} onValueChange={(value) => onAppChange(value as Exclude<ProfileType, ''>)}>
        <SelectTrigger aria-label="App type" className="w-full">
          <SelectValue placeholder="Choose an app" />
        </SelectTrigger>
        <SelectContent>
          {shownAppIds.map((id) => (
            <SelectItem key={id} disabled={!installedApps.includes(id)} value={id}>
              {appSpecs[id].displayName}
            </SelectItem>
          ))}
          {remote ? (
            <SelectItem disabled={remote.hosts.length === 0} value={remoteType}>
              Claude CLI Remote
            </SelectItem>
          ) : null}
        </SelectContent>
      </Select>
    </Field>
  )
}

type NameFieldProps = {
  /**
   * The name as typed.
   */
  name: string
  /**
   * Whether to show the slug the name will get under the input.
   */
  showSlugPreview: boolean
  /**
   * Takes the name as typed.
   */
  onNameChange: (name: string) => void
}

/**
 * The name input, with the live slug helper under it.
 */
function NameField({ name, showSlugPreview, onNameChange }: NameFieldProps) {
  return (
    <Field htmlFor="profile-name" label="Name">
      <Input
        autoFocus
        id="profile-name"
        type="text"
        value={name}
        onChange={(event) => onNameChange(event.target.value)}
        placeholder="Personal"
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
      />
      {showSlugPreview ? <SlugPreview name={name} /> : null}
    </Field>
  )
}

type SlugPreviewProps = {
  /**
   * The name as typed.
   */
  name: string
}

/**
 * The slug the name will get, as the server will derive it.
 */
function SlugPreview({ name }: SlugPreviewProps) {
  const slug = slugifyPreview(name)
  // Always rendered (non-breaking space when empty) so the slug line reserves
  // its height and the dialog doesn't shift when typing.
  return <p className="mt-1.5 font-mono text-mono text-muted-strong">{slug ? `Slug: ${slug}` : '\u00A0'}</p>
}

type FieldProps = {
  label: string
  htmlFor?: string
  children: ReactNode
}

function Field({ label, htmlFor, children }: FieldProps) {
  return (
    <div>
      <label
        htmlFor={htmlFor}
        className="mb-1.5 block font-mono text-[11.5px] font-medium uppercase tracking-[0.08em] text-muted"
      >
        {label}
      </label>
      {children}
    </div>
  )
}

/**
 * A profile on a paired server: which server, then a name the server can use
 * as its account folder, and the color it shows in with here. Claude runs on
 * the server, in tmux, so there are no surfaces on this Mac to pick.
 */
function RemoteFields({
  name,
  color,
  remote,
  typeField,
  onNameChange,
  onColorChange,
}: {
  name: string
  color: string
  remote: NonNullable<Props['remote']>
  typeField: ReactNode
  onNameChange: (name: string) => void
  onColorChange: (color: string) => void
}) {
  const host = remote.hosts.find((candidate) => candidate.id === remote.hostId)
  const trimmed = name.trim()
  return (
    <div className="space-y-4">
      {typeField}
      <Field label="Server">
        <Select value={remote.hostId} onValueChange={remote.onHostChange}>
          <SelectTrigger aria-label="Server" className="w-full">
            <SelectValue placeholder="Choose a server" />
          </SelectTrigger>
          <SelectContent>
            {remote.hosts.map((candidate) => (
              <SelectItem key={candidate.id} value={candidate.id}>
                {candidate.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field htmlFor="profile-name" label="Name">
        <Input
          autoFocus
          id="profile-name"
          type="text"
          value={name}
          onChange={(event) => onNameChange(event.target.value)}
          placeholder="work"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
        />
        <p
          className={cn(
            'mt-1.5 font-mono text-mono',
            trimmed && (!isValidRemoteProfileName(trimmed) || remote.taken) ? 'text-red' : 'text-muted-strong',
          )}
        >
          {trimmed === ''
            ? '\u00A0'
            : !isValidRemoteProfileName(trimmed)
              ? 'Letters, digits, - and _, starting with a letter or digit. "default" is taken.'
              : remote.taken
                ? `${host?.label ?? 'The server'} already has a profile called ${trimmed}.`
                : `On ${host?.label ?? 'the server'}: ~/.claude-accounts/${trimmed}`}
        </p>
      </Field>
      <Field label="Color">
        <ColorSwatchPicker value={color} onChange={onColorChange} />
      </Field>
      <p className="text-meta text-muted">
        After it's made, you sign it in: its sign-in page opens in your browser, and you paste the code back here.
      </p>
    </div>
  )
}
