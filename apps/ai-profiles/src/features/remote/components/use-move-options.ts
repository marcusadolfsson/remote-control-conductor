import type { MemoryChoice } from '@/features/profiles/components/project-memory'

import { useState } from 'react'

/** What becomes of the copy the session leaves behind. */
export type Afterwards = 'archive' | 'delete' | 'keep'

/**
 * What the user decides on the way through a move: whether to roll back a
 * newer copy, what becomes of the copy left behind, whether to resume it,
 * and what to keep of each memory note both sides changed.
 */
export function useMoveOptions() {
  const [replaceNewer, setReplaceNewer] = useState(false)
  const [afterwards, setAfterwards] = useState<Afterwards>('archive')
  const [resume, setResume] = useState(true)
  const [choices, setChoices] = useState<Record<string, MemoryChoice>>({})
  return {
    replaceNewer,
    setReplaceNewer,
    afterwards,
    setAfterwards,
    resume,
    setResume,
    choices,
    choose: (path: string, choice: MemoryChoice) => setChoices((previous) => ({ ...previous, [path]: choice })),
    /** Another destination: its plan asks its own questions. */
    reset: () => {
      setReplaceNewer(false)
      setChoices({})
    },
  }
}
