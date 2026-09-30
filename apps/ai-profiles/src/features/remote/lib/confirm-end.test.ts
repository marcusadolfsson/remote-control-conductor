import type { RemoteSession } from '@/lib/types'

import { describe, expect, it } from 'vitest'

import { confirmText } from './confirm-end'

const session = {
  id: 'abc',
  title: 'Fix login',
  lastPrompt: null,
  empty: false,
} as RemoteSession

describe('confirmText', () => {
  it('asks before stopping, saying whether there is anything to resume', () => {
    expect(confirmText({ kind: 'stop', session }, 'xjopa1')).toMatchObject({
      title: 'Stop this session?',
      description: 'Fix login',
      confirm: 'Stop',
      danger: true,
    })
    expect(confirmText({ kind: 'stop', session: { ...session, empty: true } }, 'xjopa1').body).toMatch(
      /nothing to resume/,
    )
  })

  it('asks before archiving', () => {
    expect(confirmText({ kind: 'archive', session }, 'xjopa1')).toMatchObject({
      title: 'Archive this session?',
      confirm: 'Archive',
      danger: false,
    })
  })

  it('asks before restarting every running session on the host', () => {
    expect(confirmText({ kind: 'restartAll', sessions: [session, session] }, 'xjopa1')).toMatchObject({
      title: 'Restart 2 running sessions?',
      description: 'On xjopa1.',
      confirm: 'Restart all',
    })
  })

  it('says nothing while nothing is held', () => {
    expect(confirmText(null, 'xjopa1')).toEqual({ title: '', danger: false })
  })
})
