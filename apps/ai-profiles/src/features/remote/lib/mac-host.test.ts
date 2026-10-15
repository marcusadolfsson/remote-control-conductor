import type { HostInfo } from '@/lib/types'

import { describe, expect, it } from 'vitest'

import { isMacHost } from './mac-host'

const info = (serverVersion: string) => ({ serverVersion }) as HostInfo

describe('isMacHost', () => {
  it('knows a shared Mac by its version', () => {
    expect(isMacHost(info('0.7.0 (Mac)'))).toBe(true)
    expect(isMacHost(info('0.10.2'))).toBe(false)
    expect(isMacHost(undefined)).toBe(false)
  })
})
