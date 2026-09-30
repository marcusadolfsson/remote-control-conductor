import type { RemoteSession } from '@/lib/types'

import { describe, expect, it } from 'vitest'

import {
  installedVersionOf,
  restartAllLabel,
  restartAllTitle,
  restartTitle,
  sessionTitle,
  stampToIso,
  updateVersions,
} from './session-labels'

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
    expect(
      restartTitle(session({ updatePending: true, claudeVersion: '2.1.281', installedVersion: '2.1.282' }), true),
    ).toBe(
      'Restart to update: stop it and start it again on Claude Code 2.1.282, installed on the host (it runs 2.1.281)',
    )
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

  it('names the Claude Code it would update to, when the host says', () => {
    expect(restartAllLabel(null, 4, '2.1.282')).toBe('Restart all · 4 to update (2.1.282)')
    expect(restartAllTitle(4, '2.1.282')).toMatch(/: 4 of them run an older one than 2\.1\.282$/)
  })
})

describe('update versions', () => {
  it('reads as from → to while a session waits on an update and both are known', () => {
    const waiting = session({ updatePending: true, claudeVersion: '2.1.281', installedVersion: '2.1.282' })
    expect(updateVersions(waiting)).toBe('2.1.281 → 2.1.282')
    expect(updateVersions({ ...waiting, installedVersion: null })).toBeNull()
    expect(updateVersions({ ...waiting, updatePending: false })).toBeNull()
  })

  it('takes the installed version from whichever session says', () => {
    expect(installedVersionOf([session(), session({ installedVersion: '2.1.282' })])).toBe('2.1.282')
    expect(installedVersionOf([session()])).toBeNull()
  })
})
