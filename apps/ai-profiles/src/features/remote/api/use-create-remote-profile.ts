import { useQueryClient } from '@tanstack/react-query'

import { remoteCreateAccount, remoteSetProfileColor } from '@/lib/commands'
import { queryKeys } from '@/lib/query/keys'

import { remoteSelectionId } from '../lib/remote-selection'

/**
 * Makes a profile on a host, in its colour, and refreshes what lists it.
 * Resolves to the new profile's sidebar id.
 */
export function useCreateRemoteProfile() {
  const queryClient = useQueryClient()
  return async ({ hostId, name, color }: { hostId: string; name: string; color: string }): Promise<string> => {
    await remoteCreateAccount({ hostId, name })
    await remoteSetProfileColor({ hostId, account: name, color })
    await queryClient.invalidateQueries({ queryKey: queryKeys.remote.accounts(hostId) })
    await queryClient.invalidateQueries({ queryKey: queryKeys.remote.hosts })
    return remoteSelectionId(hostId, name)
  }
}
