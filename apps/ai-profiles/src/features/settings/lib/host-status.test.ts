import type { HostInfo } from '@/lib/types'

import { describe, expect, it } from 'vitest'

import { hostStatus } from './host-status'

const answered: HostInfo = {
  hostname: 'xjopa1',
  home: '/home/m',
  serverVersion: '0.5.1',
  apiVersion: 1,
  tmux: { version: 'tmux 3.4', session: 'ai' },
  claude: { path: '/home/m/.local/bin/claude', version: '2.1.282 (Claude Code)' },
  accountsBase: '/home/m/.claude-accounts',
  includesDefault: false,
}

describe('hostStatus', () => {
  it('reads as checking until the host answers', () => {
    expect(hostStatus({ isError: false, isSuccess: false, error: null })).toEqual({
      tone: 'neutral',
      line: 'Checking…',
    })
  })

  it('names the versions a host answers with, or what it lacks', () => {
    expect(hostStatus({ isError: false, isSuccess: true, error: null, data: answered })).toEqual({
      tone: 'success',
      line: 'Claude 2.1.282 · tmux 3.4',
    })
    expect(
      hostStatus({ isError: false, isSuccess: true, error: null, data: { ...answered, claude: null, tmux: null } })
        .line,
    ).toBe('no claude · no tmux')
  })

  it('says why a host is not answering', () => {
    expect(hostStatus({ isError: true, isSuccess: false, error: new Error('offline') }).tone).toBe('danger')
  })
})
