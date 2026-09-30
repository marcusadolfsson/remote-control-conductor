import { describe, expect, it } from 'vitest'

import { isValidRemoteProfileName, newRemoteNameHint, remoteRename } from './remote-profile-name'

const invalid = 'Letters, digits, - and _, starting with a letter or digit. "default" is taken.'

describe('isValidRemoteProfileName', () => {
  it('takes what the server takes for an account folder', () => {
    expect(isValidRemoteProfileName('work_2')).toBe(true)
    expect(isValidRemoteProfileName('-work')).toBe(false)
    expect(isValidRemoteProfileName('my work')).toBe(false)
    expect(isValidRemoteProfileName('default')).toBe(false)
    expect(isValidRemoteProfileName('a'.repeat(65))).toBe(false)
  })
})

describe('newRemoteNameHint', () => {
  it('holds its line until a name is typed', () => {
    expect(newRemoteNameHint('  ', 'xjopa1', false)).toEqual({ text: '\u00A0', problem: false })
  })

  it('says where the profile goes on the server', () => {
    expect(newRemoteNameHint(' work ', 'xjopa1', false)).toEqual({
      text: 'On xjopa1: ~/.claude-accounts/work',
      problem: false,
    })
    expect(newRemoteNameHint('work', undefined, false).text).toBe('On the server: ~/.claude-accounts/work')
  })

  it('says why a name cannot be used, the rules before a clash', () => {
    expect(newRemoteNameHint('default', 'xjopa1', true)).toEqual({ text: invalid, problem: true })
    expect(newRemoteNameHint('work', 'xjopa1', true)).toEqual({
      text: 'xjopa1 already has a profile called work.',
      problem: true,
    })
    expect(newRemoteNameHint('work', undefined, true).text).toBe('The server already has a profile called work.')
  })
})

describe('remoteRename', () => {
  const base = { name: 'marcus2', taken: ['default', 'marcus1', 'marcus2'], fixed: false, hostLabel: 'xjopa1' }

  it('says where the profile lives while its name is unchanged', () => {
    expect(remoteRename({ ...base, newName: 'marcus2' })).toEqual({
      trimmed: 'marcus2',
      renaming: false,
      ok: true,
      hint: { text: 'On xjopa1: ~/.claude-accounts/marcus2', problem: false },
    })
  })

  it('takes a free name the server takes', () => {
    expect(remoteRename({ ...base, newName: ' work ' })).toMatchObject({ trimmed: 'work', renaming: true, ok: true })
  })

  it('refuses a name another profile has, ignoring case, before the rules', () => {
    expect(remoteRename({ ...base, newName: 'Marcus1' })).toMatchObject({
      ok: false,
      hint: { text: 'xjopa1 already has a profile called Marcus1.', problem: true },
    })
    expect(remoteRename({ ...base, newName: 'default' }).hint.text).toBe('xjopa1 already has a profile called default.')
    expect(remoteRename({ ...base, newName: 'my work' })).toMatchObject({ ok: false, hint: { text: invalid } })
  })

  it('says the default profile keeps its name', () => {
    expect(remoteRename({ ...base, name: 'default', newName: 'default', fixed: true }).hint).toEqual({
      text: 'The default profile is ~/.claude, and keeps its name.',
      problem: false,
    })
  })
})
