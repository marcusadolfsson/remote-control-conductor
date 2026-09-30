import { describe, expect, it } from 'vitest'

import { launchTitle } from './launch-result'

describe('launchTitle', () => {
  it('says whether it waits, and whether it was running already', () => {
    expect(launchTitle(true, true)).toBe('Waiting for you')
    expect(launchTitle(true, false)).toBe('Started, and waiting')
    expect(launchTitle(false, true)).toBe('Already running')
    expect(launchTitle(false, false)).toBe('Session started')
  })
})
