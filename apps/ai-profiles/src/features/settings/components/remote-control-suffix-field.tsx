import type { HostInfo, RemoteHost } from '@/lib/types'

import { useEffect, useState } from 'react'

import { Input } from '@/design/ui/input'
import { sessionErrorMessage } from '@/features/profiles/components/session-error-message'
import { useSetHostSettings } from '@/features/remote/api/use-remote'

import { supportsHostSettings } from '../lib/host-settings'

type Props = {
  /**
   * The paired host.
   */
  host: RemoteHost
  /**
   * What the host said about itself, once it answered.
   */
  info: HostInfo | undefined
}

/**
 * Whether the host puts a name after the Remote Control names it gives
 * sessions, "Deploy (xjopa1)", so they can be told apart from another
 * machine's in the Claude app, and which name.
 */
export function RemoteControlSuffixField({ host, info }: Props) {
  const saved = info?.settings?.remoteControlSuffix ?? null
  const setSettings = useSetHostSettings(host.id)
  const [draft, setDraft] = useState(saved ?? host.label)
  useEffect(() => setDraft(saved ?? host.label), [saved, host.label])

  if (!info) {
    return null
  }
  if (!supportsHostSettings(info.serverVersion)) {
    return (
      <p className="text-[11px] text-muted">
        Update the server to 0.6.3 or later to add its name to Remote Control sessions.
      </p>
    )
  }
  const on = saved !== null

  function save(next: string | null) {
    if (next === saved) {
      return
    }
    setSettings.mutate(next)
  }

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-2 text-[12px] text-ink-soft">
        <label className="flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            checked={on}
            disabled={setSettings.isPending}
            onChange={(event) => save(event.target.checked ? draft.trim() || host.label : null)}
            className="h-3.5 w-3.5 cursor-pointer accent-orange"
          />
          Add to Remote Control names:
        </label>
        <span className="inline-flex items-center gap-0.5 font-mono text-[11.5px] text-muted-strong">
          (
          <Input
            aria-label={`Name added to ${host.label}'s Remote Control sessions`}
            value={draft}
            maxLength={40}
            disabled={!on || setSettings.isPending}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={() => save(draft.trim() || saved)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.currentTarget.blur()
              }
            }}
            className="h-6 w-28 px-1.5 font-mono text-[11.5px]"
          />
          )
        </span>
      </div>
      {setSettings.isError ? (
        <p role="alert" className="text-[11px] text-red">
          {sessionErrorMessage(setSettings.error, 'The setting could not be saved.')}
        </p>
      ) : (
        <p className="text-[11px] text-muted">
          Sessions started or restarted on {host.label} from now on. Useful when the same kind of session runs on more
          than one machine.
        </p>
      )}
    </div>
  )
}
