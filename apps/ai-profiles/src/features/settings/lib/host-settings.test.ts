import { describe, expect, it } from 'vitest'

import { supportsHostSettings } from './host-settings'

describe('supportsHostSettings', () => {
  it('takes settings from 0.6.3 on', () => {
    expect(supportsHostSettings('0.6.3')).toBe(true)
    expect(supportsHostSettings('0.7.0')).toBe(true)
    expect(supportsHostSettings('1.0.0')).toBe(true)
    expect(supportsHostSettings('0.6.2')).toBe(false)
    expect(supportsHostSettings('0.5.9')).toBe(false)
  })

  it('takes a version it cannot read to be older', () => {
    expect(supportsHostSettings(undefined)).toBe(false)
    expect(supportsHostSettings('dev')).toBe(false)
  })
})
