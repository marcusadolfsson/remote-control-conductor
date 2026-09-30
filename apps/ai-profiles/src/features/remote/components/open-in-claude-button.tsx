import { useState } from 'react'

import { Laptop } from 'lucide-react'

import { Button, useToast } from '@/design'
import { sessionErrorMessage } from '@/features/profiles/components/session-error-message'
import { remoteOpenInClaude } from '@/lib/commands'

/**
 * Opens the session's Remote Control view in the Claude app on this Mac that
 * is signed in as the profile's account, starting it if it isn't running, or
 * on claude.ai when none is, or it can't be reached on its own. Shown only
 * while Remote Control is connected, in its own blue, so it also says that
 * the session is in the Claude app.
 */
export function OpenInClaudeButton({
  email,
  bridgeSessionId,
  profileId,
}: {
  email: string | null
  bridgeSessionId: string
  /** Open it in this desktop profile, when it's signed in as `email`. */
  profileId?: string
}) {
  const toast = useToast()
  const [opening, setOpening] = useState(false)
  return (
    <Button
      variant="ghost"
      size="sm"
      aria-label="Open in Claude"
      title="Remote Control is connected. Open it in the Claude app signed in as this profile."
      className="border border-blue/45 bg-blue/[0.12] text-blue hover:bg-blue/20 hover:text-blue"
      disabled={opening}
      onClick={async () => {
        setOpening(true)
        try {
          const opened = await remoteOpenInClaude({ email, bridgeSessionId, profileId })
          if (opened.app) {
            toast.success(`Opened in ${opened.app}`)
          } else {
            toast.info(
              'Opened on claude.ai',
              opened.note ??
                (email ? `No Claude app here is signed in as ${email}.` : 'This profile has no account on record.'),
            )
          }
        } catch (caught) {
          toast.error('Could not open it.', sessionErrorMessage(caught))
        } finally {
          setOpening(false)
        }
      }}
    >
      <Laptop aria-hidden className="h-3.5 w-3.5" />
    </Button>
  )
}
