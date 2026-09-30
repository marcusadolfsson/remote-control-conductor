import type { WorkspaceRemote } from '@/features/app-shell/components/workspace'
import type { RemoteHost, SidebarEntry } from '@/lib/types'

import { Activity } from 'react'

import { QueryErrorBoundary } from '@/lib/query/error-boundary'

import {
  parseRemoteSelection,
  REMOTE_CONTROL_ID,
  type RemoteSelection,
  remoteSelectionId,
} from '../lib/remote-selection'
import { RemoteAccountDetail } from './remote-account-detail'
import { RemoteControlOverview, RemoteControlSidebarRow } from './remote-control-overview'
import { RemoteHostSection } from './remote-host-section'
import { SignInDialog } from './sign-in-dialog'

/**
 * Pure: whether the window has nothing to put in a sidebar, so the empty
 * state takes it whole. Paired hosts alone are enough for the sidebar.
 */
export function isEmptyWindow(entries: Array<SidebarEntry>, hosts: Array<RemoteHost>): boolean {
  return entries.length === 0 && hosts.length === 0
}

type RemoteWorkspaceInput = {
  /**
   * The paired hosts.
   */
  hosts: Array<RemoteHost>
  /**
   * The selected sidebar id, or `null`.
   */
  selectedId: string | null
  /**
   * Whether the profile side of the window is up, rather than Settings.
   */
  profileSide: boolean
  /**
   * The ids ⌘1…⌘9 select, in order, for the ⌘N chips on host rows.
   */
  shortcutIds: Array<string>
  /**
   * Selects a sidebar id and shows its pane.
   */
  onSelect: (id: string) => void
}

/**
 * What the paired hosts add to the workspace: the Remote Control row and a
 * section per host in the sidebar, and the panes for what's selected there.
 */
export function remoteWorkspace({
  hosts,
  selectedId,
  profileSide,
  shortcutIds,
  onSelect,
}: RemoteWorkspaceInput): WorkspaceRemote {
  return {
    alwaysShowAppGlyphs: hosts.length > 0,
    renderSections: (query) => [
      hosts.length > 0 && 'remote control'.includes(query.trim().toLowerCase()) ? (
        <RemoteControlSidebarRow
          key={REMOTE_CONTROL_ID}
          selected={selectedId === REMOTE_CONTROL_ID}
          onSelect={() => onSelect(REMOTE_CONTROL_ID)}
        />
      ) : null,
      ...hosts.map((host) => (
        <RemoteHostSection
          key={host.id}
          host={host}
          selectedId={selectedId}
          query={query}
          shortcutIndexFor={(id) => shortcutIds.indexOf(id)}
          onSelect={onSelect}
        />
      )),
    ],
    panes: <RemotePanes selectedId={selectedId} profileSide={profileSide} onSelect={onSelect} />,
  }
}

type RemotePanesProps = {
  /**
   * The selected sidebar id, or `null`.
   */
  selectedId: string | null
  /**
   * Whether the profile side of the window is up, rather than Settings.
   */
  profileSide: boolean
  /**
   * Selects a sidebar id: a host profile after a rename, or one picked in
   * the Remote Control overview.
   */
  onSelect: (id: string) => void
}

/**
 * A host profile's pane, and the Remote Control overview, each kept mounted
 * while hidden as the workspace's other panes are.
 */
function RemotePanes({ selectedId, profileSide, onSelect }: RemotePanesProps) {
  const remoteSelected = parseRemoteSelection(selectedId)
  const mode = (selected: boolean) => (profileSide && selected ? 'visible' : 'hidden')
  return (
    <>
      <Activity mode={mode(remoteSelected !== null)}>
        <HostProfilePane key={selectedId} selected={remoteSelected} onSelect={onSelect} />
      </Activity>
      <Activity mode={mode(selectedId === REMOTE_CONTROL_ID)}>
        <OverviewPane shown={selectedId === REMOTE_CONTROL_ID} onSelect={onSelect} />
      </Activity>
    </>
  )
}

type HostProfilePaneProps = {
  /**
   * The host profile selected, or `null` when none is.
   */
  selected: RemoteSelection | null
  /**
   * Selects the profile's new id after a rename.
   */
  onSelect: (id: string) => void
}

/**
 * The selected host profile's pane, or nothing.
 */
function HostProfilePane({ selected, onSelect }: HostProfilePaneProps) {
  if (selected === null) {
    return null
  }
  return (
    <QueryErrorBoundary>
      <RemoteAccountDetail
        hostId={selected.hostId}
        account={selected.account}
        onRenamed={(name) => onSelect(remoteSelectionId(selected.hostId, name))}
      />
    </QueryErrorBoundary>
  )
}

type OverviewPaneProps = {
  /**
   * Whether the Remote Control entry is selected.
   */
  shown: boolean
  /**
   * Selects a host profile picked in the overview.
   */
  onSelect: (id: string) => void
}

/**
 * The Remote Control overview while its entry is selected, or nothing.
 */
function OverviewPane({ shown, onSelect }: OverviewPaneProps) {
  if (!shown) {
    return null
  }
  return (
    <QueryErrorBoundary>
      <RemoteControlOverview onSelectProfile={onSelect} />
    </QueryErrorBoundary>
  )
}

type NewProfileSignInProps = {
  /**
   * The paired hosts.
   */
  hosts: Array<RemoteHost>
  /**
   * The host profile just made, to sign in, or `null`.
   */
  signingIn: { hostId: string; account: string } | null
  /**
   * Closes the sign-in, done or skipped.
   */
  onClose: () => void
}

/**
 * The sign-in for a host profile just made, while its host is still paired.
 */
export function NewProfileSignIn({ hosts, signingIn, onClose }: NewProfileSignInProps) {
  const host = signingIn ? hosts.find((candidate) => candidate.id === signingIn.hostId) : undefined
  if (!signingIn || !host) {
    return null
  }
  return <SignInDialog open host={host} account={signingIn.account} cancelLabel="Skip for now" onClose={onClose} />
}
