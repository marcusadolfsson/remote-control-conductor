import type { SidebarEntry } from '@/lib/types'

import { useHotkey } from '@tanstack/react-hotkeys'

const profileIndexKeys = ['Mod+1', 'Mod+2', 'Mod+3', 'Mod+4', 'Mod+5', 'Mod+6', 'Mod+7', 'Mod+8', 'Mod+9'] as const

type SelectByIndexHotkeyProps = {
  /**
   * The zero-based profile slot this binding selects.
   */
  index: number
  /**
   * Whether the binding is live.
   */
  enabled: boolean
  /**
   * Called when the slot's keys are pressed.
   */
  onSelect: (index: number) => void
}

/**
 * One Mod+N binding per profile slot. Each instance registers a single
 * hotkey — kept as a child component so we can map over indices without
 * violating the rules-of-hooks ban on conditional/looped hook calls.
 * The discrete `profileIndexKeys` tuple keeps the keys narrowly typed
 * (`Mod+${number}` is too broad for the library's Hotkey union).
 */
function SelectByIndexHotkey({ index, enabled, onSelect }: SelectByIndexHotkeyProps) {
  useHotkey(
    profileIndexKeys[index],
    () => {
      onSelect(index)
    },
    { enabled },
  )
  return null
}

type ProfileIndexHotkeysProps = {
  /**
   * The sidebar entries, in display order.
   */
  entries: Array<SidebarEntry>
  /**
   * More profiles to number after this Mac's, in sidebar order: each paired
   * server's, by selection id.
   */
  extraIds?: Array<string>
  /**
   * Whether the bindings are live.
   */
  enabled: boolean
  /**
   * Called with the profile id of the pressed slot.
   */
  onSelect: (profileId: string) => void
}

/**
 * Mod+1..Mod+9 — one binding per managed profile slot (the default row is
 * not numbered), then per server profile.
 */
export function ProfileIndexHotkeys({ entries, extraIds = [], enabled, onSelect }: ProfileIndexHotkeysProps) {
  const ids = [
    ...entries
      .filter((entry): entry is Extract<SidebarEntry, { kind: 'managed' }> => entry.kind === 'managed')
      .map((managedEntry) => managedEntry.profile.id),
    ...extraIds,
  ]
  return ids.slice(0, 9).map((id, index) => (
    <SelectByIndexHotkey
      key={id}
      index={index}
      enabled={enabled}
      onSelect={() => {
        onSelect(id)
      }}
    />
  ))
}
