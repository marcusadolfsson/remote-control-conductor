import type { RemoteSession } from '@/lib/types'

import { describe, expect, it } from 'vitest'

import { restartAllLabel, restartAllTitle, restartTitle, sessionTitle, stampToIso } from './session-labels'

function session(overrides: Partial<RemoteSession> = {}): RemoteSession {
  return {
    id: 'abc',
    cwd: '/home/marcus/app',
    title: null,
    named: false,
    lastPrompt: null,
    updatedAt: '2026-09-01T12:00:00Z',
    sizeBytes: 0,
    running: true,
    window: null,
    remoteControl: false,
    bridgeSessionId: null,
    ...overrides,
  }
}

describe('sessionTitle', () => {
  it('calls a session by its title, else its last prompt, else its id', () => {
    expect(sessionTitle(session({ title: 'Fix login', lastPrompt: 'hi' }))).toBe('Fix login')
    expect(sessionTitle(session({ lastPrompt: 'hi' }))).toBe('hi')
    expect(sessionTitle(session())).toBe('abc')
  })
})

describe('stampToIso', () => {
  it('reads a host stamp as local time', () => {
    expect(stampToIso('20260901-081502')).toBe(new Date(2026, 8, 1, 8, 15, 2).toISOString())
  })

  it('falls back to now for a stamp it cannot read', () => {
    const before = Date.now()
    const read = Date.parse(stampToIso('yesterday'))
    expect(read).toBeGreaterThanOrEqual(before)
  })
})

describe('restartTitle', () => {
  it('says a restart takes on the newer claude, and which one the session runs', () => {
    expect(restartTitle(session({ updatePending: true, claudeVersion: '2.1.0' }), true)).toContain('(it runs 2.1.0)')
    expect(restartTitle(session({ updatePending: true }), true)).toContain('(it runs an older one)')
  })

  it('says a session outside tmux restarts in it', () => {
    expect(restartTitle(session(), true)).toBe("Restart: stop it and start it again on the host's current claude")
    expect(restartTitle(session(), false)).toBe(
      "Restart: stop it and start it again in tmux, on the host's current claude",
    )
  })
})

describe('Restart all', () => {
  it('says how far it has got while it runs', () => {
    expect(restartAllLabel({ done: 1, total: 3 }, 2)).toBe('Restarting 2 of 3…')
  })

  it('says how many sessions it would update', () => {
    expect(restartAllLabel(null, 2)).toBe('Restart all · 2 to update')
    expect(restartAllLabel(null, 0)).toBe('Restart all')
    expect(restartAllTitle(2)).toMatch(/: 2 of them run an older one$/)
    expect(restartAllTitle(0)).toBe("Stop every running session and start it again on the host's current claude")
  })
})
