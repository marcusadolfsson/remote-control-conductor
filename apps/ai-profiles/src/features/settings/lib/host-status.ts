import type { HostInfo } from '@/lib/types'

// cross-feature: a host's errors read as the remote views word them
import { sessionErrorMessage } from '@/features/profiles/components/session-error-message'

/**
 * What asking a host about itself has come to so far.
 */
type HostInfoQuery = {
  /**
   * The host didn't answer, or refused.
   */
  isError: boolean
  /**
   * The host answered.
   */
  isSuccess: boolean
  /**
   * Why it didn't, when it didn't.
   */
  error: unknown
  /**
   * What it said, once it answered.
   */
  data?: HostInfo
}

/**
 * How a host's row reads: its status dot's tone, and the line under its name.
 */
type HostStatus = {
  tone: 'danger' | 'success' | 'neutral'
  line: string
}

/**
 * Pure: a paired host's status, from the question to it: its Claude Code and
 * tmux versions once it answers, why not when it doesn't.
 */
export function hostStatus(info: HostInfoQuery): HostStatus {
  if (info.isError) {
    return { tone: 'danger', line: sessionErrorMessage(info.error, 'Not answering.') }
  }
  const tone = info.isSuccess ? 'success' : 'neutral'
  if (!info.data) {
    return { tone, line: 'Checking…' }
  }
  const claude = info.data.claude?.version ? `Claude ${info.data.claude.version.split(' ')[0]}` : 'no claude'
  return { tone, line: [claude, info.data.tmux?.version ?? 'no tmux'].join(' · ') }
}
