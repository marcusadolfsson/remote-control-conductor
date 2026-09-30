import { useMemo, useState } from 'react'

import { useRemoteAccounts, useRemoteTransferPlan } from '../api/use-remote'

/**
 * Where a session on a host can move: the host's other profiles, the one
 * picked (the first until one is), and the host's plan for moving it there,
 * read again as the pick changes.
 */
export function useMoveDestination(hostId: string, account: string, sessionId: string) {
  const accounts = useRemoteAccounts(hostId)
  const destinations = useMemo(
    () => (accounts.data ?? []).map((candidate) => candidate.name).filter((name) => name !== account),
    [accounts.data, account],
  )
  const [chosen, setChosen] = useState<string | null>(null)
  const to = chosen ?? destinations[0] ?? null
  const plan = useRemoteTransferPlan(hostId, account, sessionId, to)
  return { destinations, to, plan, pick: setChosen }
}
