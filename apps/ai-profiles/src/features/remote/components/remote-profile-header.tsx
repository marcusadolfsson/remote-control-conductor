import type { RemoteAccount, RemoteHost } from '@/lib/types'

import { Fragment } from 'react'

import { MoreHorizontal, Plus, Server } from 'lucide-react'

import { cn } from '@/design'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/design/ui/dropdown-menu'
import {
  headerControlClasses,
  ProfileDetailHeader,
  ProfileSwatch,
} from '@/features/profiles/components/profile-detail-header'

import { sublineParts } from '../lib/profile-subline'

/** A dialog the profile's header opens. */
export type ProfileDialog = 'start' | 'signIn' | 'signOut' | 'switch' | 'edit' | 'delete'

type RemoteProfileHeaderProps = {
  /** The host the profile is on. */
  host: RemoteHost
  /** The profile's name. */
  name: string
  /** The profile, once the host has listed it. */
  account: RemoteAccount | undefined
  /** The host can't be reached. */
  offline: boolean
  /** Opens one of the profile's dialogs. */
  onOpen: (dialog: ProfileDialog) => void
}

type SublineProps = {
  /** The host's name. */
  hostLabel: string
  /** The profile, once the host has listed it. */
  account: RemoteAccount | undefined
  /** The host can't be reached. */
  offline: boolean
}

type ProfileMenuProps = {
  /** The profile the menu is for. */
  account: RemoteAccount
  /** Opens one of the profile's dialogs. */
  onOpen: (dialog: ProfileDialog) => void
}

const menuTriggerClasses = 'w-7 px-0 text-muted hover:not-disabled:text-ink'

/** Each subline part's color, when it isn't the subline's own. */
const toneClasses = { danger: 'text-red', warning: 'text-amber', quiet: 'text-muted-strong' }

/**
 * A remote profile's header: its color (or the host's glyph), whose account
 * it is and for how long, New session, and its rarer actions in a menu.
 */
export function RemoteProfileHeader({ host, name, account, offline, onOpen }: RemoteProfileHeaderProps) {
  const color = host.profiles?.[name]?.color ?? null
  return (
    <ProfileDetailHeader
      name={name}
      swatch={color ? <ProfileSwatch color={color} /> : <HostSwatch />}
      subline={<Subline hostLabel={host.label} account={account} offline={offline} />}
      action={
        <button
          type="button"
          className={headerControlClasses}
          disabled={offline || !account}
          onClick={() => onOpen('start')}
        >
          <Plus aria-hidden className="h-3.5 w-3.5" strokeWidth={1.9} />
          New session
        </button>
      }
      menu={account && !offline ? <ProfileMenu account={account} onOpen={onOpen} /> : undefined}
    />
  )
}

function HostSwatch() {
  return (
    <div
      aria-hidden
      className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-white text-ink-soft shadow-[inset_0_0_0_1px_rgba(0,0,0,0.06),0_2px_6px_-3px_rgba(0,0,0,0.18)] dark:bg-cream-2"
    >
      <Server className="h-5 w-5" strokeWidth={1.6} />
    </div>
  )
}

/** The host's name, then what the profile's state says, each part after a dot. */
function Subline({ hostLabel, account, offline }: SublineProps) {
  const separator = <span className="mx-2 text-border">·</span>
  return (
    <>
      <span>{hostLabel}</span>
      {sublineParts(account, offline).map((part) => (
        <Fragment key={part.id}>
          {separator}
          <span className={part.tone ? toneClasses[part.tone] : undefined} title={part.title}>
            {part.text}
          </span>
        </Fragment>
      ))}
    </>
  )
}

/**
 * Rare things done to the profile: its color, switching its account, signing
 * it in or out, and deleting it.
 */
function ProfileMenu({ account, onOpen }: ProfileMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" aria-label="More actions" className={cn(headerControlClasses, menuTriggerClasses)}>
          <MoreHorizontal aria-hidden className="h-4 w-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuItem className="px-2 py-1.5 text-[12px]" onSelect={() => onOpen('edit')}>
          Edit profile…
        </DropdownMenuItem>
        {account.signedIn ? (
          <DropdownMenuItem className="px-2 py-1.5 text-[12px]" onSelect={() => onOpen('switch')}>
            Switch account…
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem
          className="px-2 py-1.5 text-[12px]"
          onSelect={() => onOpen(account.signedIn ? 'signOut' : 'signIn')}
        >
          {account.signedIn ? 'Sign out…' : 'Sign in…'}
        </DropdownMenuItem>
        {account.isDefault ? null : (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              className="px-2 py-1.5 text-[12px]"
              onSelect={() => onOpen('delete')}
            >
              Delete profile…
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
