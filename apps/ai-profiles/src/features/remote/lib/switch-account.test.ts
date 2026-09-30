import { describe, expect, it } from 'vitest'

import { sameAccount, sessionCount, switchEffect } from './switch-account'

describe('switchEffect', () => {
  it('says only that nothing moves when no session runs', () => {
    expect(switchEffect(0)).toBe('Nothing moves, and no other profile is touched.')
  })

  it('says the running sessions stop and resume', () => {
    expect(switchEffect(1)).toMatch(/^Its 1 session stops, and resumes under the new account/)
    expect(switchEffect(2)).toMatch(/^Its 2 sessions stop, and resume under the new account/)
  })
})

describe('sessionCount', () => {
  it('counts one session and several', () => {
    expect(sessionCount(1)).toBe('1 session')
    expect(sessionCount(3)).toBe('3 sessions')
  })
})

describe('sameAccount', () => {
  it('matches emails regardless of case, and never an unknown one', () => {
    expect(sameAccount('A@x.com', 'a@x.com')).toBe(true)
    expect(sameAccount('a@x.com', 'b@x.com')).toBe(false)
    expect(sameAccount(null, 'a@x.com')).toBe(false)
  })
})
