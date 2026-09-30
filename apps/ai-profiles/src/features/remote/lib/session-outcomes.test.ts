import type { RemoteTransferReport } from '@/lib/types'

import { describe, expect, it } from 'vitest'

import { movedDetails, restartAllSummary } from './session-outcomes'

function report(overrides: Partial<RemoteTransferReport> = {}): RemoteTransferReport {
  return {
    changed: true,
    backupDir: null,
    memory: [],
    archivedTo: null,
    freedBytes: null,
    deleteError: null,
    launch: null,
    resumeError: null,
    ...overrides,
  }
}

describe('movedDetails', () => {
  it('says nothing more when the move only moved it', () => {
    expect(movedDetails(report(), 'marcus1')).toBeUndefined()
  })

  it('says where it resumed, that the copy left behind went, and what memory came along', () => {
    const launch = {
      window: { session: 'ai', windowId: '@4', paneId: '%4' },
      alreadyRunning: false,
      sessionId: null,
      remoteControlName: null,
      attention: null,
      attachCommand: 'tmux attach -t ai \\; select-window -t @4',
    }
    expect(movedDetails(report({ launch, freedBytes: 1024, memory: ['add a.md', 'merge b.md'] }), 'marcus1')).toBe(
      'Resumed in tmux window @4. Deleted the copy in marcus1. Project memory: 2 notes brought over.',
    )
    expect(movedDetails(report({ memory: ['add a.md'] }), 'marcus1')).toBe('Project memory: 1 note brought over.')
  })
})

describe('restartAllSummary', () => {
  it('lists what failed, one per line', () => {
    expect(restartAllSummary(3, ['a: gone', 'b: busy'], 0, 'xjopa1')).toEqual({
      ok: false,
      title: 'Restarted 1 of 3.',
      detail: 'a: gone\nb: busy',
    })
  })

  it('says how many restarted, and how many wait on a question', () => {
    expect(restartAllSummary(2, [], 0, 'xjopa1')).toEqual({
      ok: true,
      title: 'Restarted 2 sessions on xjopa1',
      detail: undefined,
    })
    expect(restartAllSummary(1, [], 1, 'xjopa1')).toEqual({
      ok: true,
      title: 'Restarted 1 session on xjopa1',
      detail: '1 is waiting for you in its window.',
    })
  })
})
