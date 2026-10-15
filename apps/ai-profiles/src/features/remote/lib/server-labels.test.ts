import { describe, expect, it } from 'vitest'

import { restartAllServersLabel, restartAllServersTitle } from './server-labels'

describe('server labels', () => {
  it('says how many servers wait on an update', () => {
    expect(restartAllServersLabel(0)).toBe('Restart all')
    expect(restartAllServersLabel(2)).toBe('Restart all · 2 to update')
    expect(restartAllServersTitle(3, 1)).toMatch(/each of the 3 .*: 1 of them run an older one$/)
  })
})
