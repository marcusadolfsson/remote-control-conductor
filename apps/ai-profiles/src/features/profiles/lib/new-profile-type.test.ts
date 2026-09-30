import { describe, expect, it } from 'vitest'

import { createDescription, initialProfileType, localAppOf } from './new-profile-type'

describe('initialProfileType', () => {
  it('opens on a server profile when opened for a server', () => {
    expect(initialProfileType('h1', ['claude'])).toBe('remote')
  })

  it('otherwise picks the only installed app, or leaves the choice open', () => {
    expect(initialProfileType(undefined, ['claude'])).toBe('claude')
    expect(initialProfileType(undefined, ['claude', 'codex'])).toBe('')
  })
})

describe('localAppOf', () => {
  it('is no app on this Mac for a server profile', () => {
    expect(localAppOf('remote')).toBe('')
    expect(localAppOf('claude')).toBe('claude')
  })
})

describe('createDescription', () => {
  it('describes a server profile apart from one on this Mac', () => {
    expect(createDescription('remote')).toMatch(/^A profile on a server/)
    expect(createDescription('claude')).toMatch(/^A profile bundles/)
  })
})
