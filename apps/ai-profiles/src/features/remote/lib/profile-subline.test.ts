import type { RemoteAccount } from '@/lib/types'

import { describe, expect, it } from 'vitest'

import { signInLeft, sublineParts } from './profile-subline'

const hour = 3_600_000
const now = Date.parse('2026-09-01T12:00:00Z')

function account(overrides: Partial<RemoteAccount> = {}): RemoteAccount {
  return {
    name: 'marcus2',
    isDefault: false,
    configDir: '/home/marcus/.claude-accounts/marcus2',
    account: { email: 'marcus@example.com', name: 'Marcus', organization: null, plan: 'Max' },
    signedIn: true,
    signedInUntil: null,
    sessions: 0,
    runningSessions: 0,
    ...overrides,
  }
}

describe('signInLeft', () => {
  it('says nothing without a date it can read', () => {
    expect(signInLeft(null, now)).toBeNull()
    expect(signInLeft('not a date', now)).toBeNull()
  })

  it('counts days, then hours, then says it is nearly out', () => {
    expect(signInLeft(new Date(now + 27 * 24 * hour).toISOString(), now)).toBe('27 days left')
    expect(signInLeft(new Date(now + 30 * hour).toISOString(), now)).toBe('1 day left')
    expect(signInLeft(new Date(now + 5 * hour).toISOString(), now)).toBe('5 hours left')
    expect(signInLeft(new Date(now + hour).toISOString(), now)).toBe('less than 2 hours left')
  })

  it('says a sign-in that ran out has expired', () => {
    expect(signInLeft(new Date(now - hour).toISOString(), now)).toBe('expired')
  })
})

describe('sublineParts', () => {
  it('says only that the host is offline', () => {
    expect(sublineParts(account(), true)).toEqual([{ id: 'offline', text: 'offline', tone: 'danger' }])
  })

  it('says nothing about a profile not listed yet', () => {
    expect(sublineParts(undefined, false)).toEqual([])
  })

  it('says only that a profile is signed out', () => {
    expect(sublineParts(account({ signedIn: false }), false)).toEqual([
      { id: 'signedOut', text: 'Signed out', tone: 'warning' },
    ])
  })

  it('says whose account it is, on what plan, and how long the sign-in lasts', () => {
    // An hour over three days, so the clock moving on while the test runs
    // can't make it two.
    const until = new Date(Date.now() + 3 * 24 * hour + hour).toISOString()
    const parts = sublineParts(account({ signedInUntil: until }), false)
    expect(parts.map((part) => part.id)).toEqual(['identity', 'plan', 'left'])
    expect(parts[0]).toEqual({ id: 'identity', text: 'marcus@example.com', title: account().configDir })
    expect(parts[1]).toEqual({ id: 'plan', text: 'Max' })
    expect(parts[2]).toMatchObject({ text: '3 days left', tone: 'quiet' })
    expect(parts[2].title).toMatch(/^Signed in until /)
  })

  it('falls back to the account’s name, and leaves out what it does not know', () => {
    const parts = sublineParts(
      account({ account: { email: null, name: 'Marcus', organization: null, plan: null } }),
      false,
    )
    expect(parts).toEqual([{ id: 'identity', text: 'Marcus', title: account().configDir }])
  })
})
