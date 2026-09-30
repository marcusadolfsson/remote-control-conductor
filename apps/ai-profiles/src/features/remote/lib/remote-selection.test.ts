import { describe, expect, it } from 'vitest'

import { isLiveRemoteSelection, parseRemoteSelection, REMOTE_CONTROL_ID, remoteSelectionId } from './remote-selection'

describe('remote selection ids', () => {
  it('round-trips a host and account', () => {
    const id = remoteSelectionId('7d1c-uuid', 'marcus2')
    expect(id).toBe('remote:7d1c-uuid:marcus2')
    expect(parseRemoteSelection(id)).toEqual({ hostId: '7d1c-uuid', account: 'marcus2' })
  })

  it('ignores local ids and malformed ones', () => {
    expect(parseRemoteSelection(null)).toBeNull()
    expect(parseRemoteSelection('default:claude')).toBeNull()
    expect(parseRemoteSelection('3f2a-profile-uuid')).toBeNull()
    expect(parseRemoteSelection('remote:')).toBeNull()
    expect(parseRemoteSelection('remote:host')).toBeNull()
    expect(parseRemoteSelection('remote:host:')).toBeNull()
    expect(parseRemoteSelection('remote::acct')).toBeNull()
  })
})

describe('isLiveRemoteSelection', () => {
  const hosts = [{ id: 'h1' }]

  it('holds the Remote Control entry only while a host is paired', () => {
    expect(isLiveRemoteSelection(REMOTE_CONTROL_ID, hosts)).toBe(true)
    expect(isLiveRemoteSelection(REMOTE_CONTROL_ID, [])).toBe(false)
  })

  it('holds an account only while its host is paired', () => {
    expect(isLiveRemoteSelection(remoteSelectionId('h1', 'work'), hosts)).toBe(true)
    expect(isLiveRemoteSelection(remoteSelectionId('h2', 'work'), hosts)).toBe(false)
    expect(isLiveRemoteSelection('default:claude', hosts)).toBe(false)
  })
})
