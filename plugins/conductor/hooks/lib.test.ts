import type { ConductorSession } from '../types'

import { describe, expect, test } from 'claude-code/testing'

import {
  addressOrder,
  claudeUrl,
  describeLaunch,
  errorMessage,
  parseHostList,
  parseSessionKey,
  readCurl,
  runningFirst,
  sessionAction,
  sessionKey,
  splitStatus,
  summarize,
  toAccount,
  toSession,
} from './lib'

const host = {
  id: 'h1',
  label: 'xjopa1',
  addresses: ['100.1.1.1:7443', 'xjopa1:7443'],
  fingerprint: 'ab',
}

const session = (over: Partial<ConductorSession> = {}): ConductorSession => ({
  id: 's1',
  title: 'One',
  cwd: '~/one',
  running: true,
  waiting: false,
  remoteControl: true,
  updatePending: false,
  bridgeSessionId: 'session_01',
  ...over,
})

describe('parseHostList', () => {
  test("reads a list, or { hosts }, and drops what isn't a host", () => {
    expect(parseHostList(JSON.stringify([host, { id: 'no-fingerprint' }]))).toEqual([host])
    expect(parseHostList(JSON.stringify({ hosts: [host] }))).toEqual([host])
    expect(parseHostList(JSON.stringify({ hosts: 'nope' }))).toEqual([])
  })
})

test('addressOrder tries the last good address first, once', () => {
  expect(addressOrder({ ...host, lastGoodAddress: 'xjopa1:7443' })).toEqual(['xjopa1:7443', '100.1.1.1:7443'])
  expect(addressOrder(host)).toEqual(host.addresses)
})

test('splitStatus takes the status off the last line', () => {
  expect(splitStatus('{"a":1}\n200')).toEqual({ status: 200, body: '{"a":1}' })
  expect(splitStatus('\n204')).toEqual({ status: 204, body: '' })
  expect(splitStatus('garbage')).toEqual({ status: 0, body: '' })
})

describe('toSession', () => {
  const wire = { id: 'abcdef1234', running: true, remoteControl: true }

  test('titles a session by its title, its last prompt, or its id', () => {
    expect(toSession({ ...wire, title: 'Named' }, '/home/m').title).toBe('Named')
    expect(toSession({ ...wire, title: '', lastPrompt: 'fix it' }, '/home/m').title).toBe('fix it')
    expect(toSession(wire, '/home/m').title).toBe('abcdef12')
  })

  test('shortens the folder under the host home', () => {
    expect(toSession({ ...wire, cwd: '/home/m/brain' }, '/home/m').cwd).toBe('~/brain')
    expect(toSession({ ...wire, cwd: '/www/site' }, '/home/m').cwd).toBe('/www/site')
    expect(toSession(wire, '/home/m').cwd).toBe(null)
  })

  test('keeps the claude.ai id only while Remote Control is on', () => {
    expect(toSession({ ...wire, bridgeSessionId: 'session_x' }, '').bridgeSessionId).toBe('session_x')
    expect(toSession({ ...wire, remoteControl: false, bridgeSessionId: 'session_x' }, '').bridgeSessionId).toBe(null)
  })
})

test('toAccount takes the email from the signed-in account', () => {
  expect(toAccount({ name: 'Misc', signedIn: true, account: { email: 'a@b.c' } }, [])).toEqual({
    name: 'Misc',
    email: 'a@b.c',
    signedIn: true,
    sessions: [],
  })
  expect(toAccount({ name: 'Misc', signedIn: false }, []).email).toBe(null)
})

test('runningFirst keeps each group in order', () => {
  const list = [session({ id: 'a', running: false }), session({ id: 'b' }), session({ id: 'c', running: false })]
  expect(runningFirst(list).map((s) => s.id)).toEqual(['b', 'a', 'c'])
})

test('sessionKey and parseSessionKey round-trip', () => {
  expect(parseSessionKey(sessionKey('h1', 'Misc', 's1'))).toEqual({ hostId: 'h1', account: 'Misc', sessionId: 's1' })
})

test('claudeUrl needs a claude.ai id', () => {
  expect(claudeUrl(session())).toBe('https://claude.ai/code/session_01')
  expect(claudeUrl(session({ bridgeSessionId: null }))).toBe(null)
})

test("errorMessage prefers the server's own message", () => {
  expect(errorMessage(404, '{"error":{"code":"not_found","message":"No such session."}}')).toBe('No such session.')
  expect(errorMessage(502, 'Bad gateway')).toBe('HTTP 502 Bad gateway')
  expect(errorMessage(500, '')).toBe('HTTP 500')
})

test('describeLaunch says what a resume or restart did', () => {
  expect(describeLaunch('resume', 'One', {})).toBe('One resumed.')
  expect(describeLaunch('resume', 'One', { alreadyRunning: true })).toBe('One was already running.')
  expect(describeLaunch('restart', 'One', {})).toBe('One restarted.')
  expect(describeLaunch('resume', 'One', { attention: { kind: 'trustPrompt' } })).toBe(
    'One is waiting for its folder to be trusted: open its window on the host.',
  )
  expect(describeLaunch('restart', 'One', { attention: { kind: 'waiting' } })).toBe(
    'One started, and is waiting for something on screen.',
  )
})

describe('readCurl', () => {
  const run = (exitCode: number, stdout = '', stderr = '') => ({ exitCode, stdout, stderr })

  test('answers the JSON of a 2xx', () => {
    expect(readCurl(run(0, '{"ok":true}\n200'))).toEqual({ ok: true })
    expect(readCurl(run(0, '\n204'))).toEqual({})
  })

  test('answers null when the address is unreachable', () => {
    expect(readCurl(run(7))).toBe(null)
    expect(readCurl(run(28))).toBe(null)
  })

  test('throws on a key mismatch, a curl failure, or an error status', () => {
    expect(() => readCurl(run(90))).toThrow("the server's key doesn't match the pairing")
    expect(() => readCurl(run(4, '', 'no token in the Keychain\n'))).toThrow('no token in the Keychain')
    expect(() => readCurl(run(0, '{"error":{"message":"Nope."}}\n409'))).toThrow('Nope.')
  })
})

test('sessionAction posts trustFolder: false, except to stop', () => {
  expect(sessionAction('My Acct', 's1', 'stop')).toEqual({
    path: '/v1/accounts/My%20Acct/sessions/s1/stop',
    body: undefined,
  })
  expect(sessionAction('Misc', 's1', 'resume').body).toEqual({ trustFolder: false })
})

test('summarize writes a line per host, account and session', () => {
  const text = summarize({
    isLoading: false,
    updatedAt: 1,
    error: null,
    hosts: [
      {
        id: 'h1',
        label: 'xjopa1',
        address: 'a',
        serverVersion: '0.6.3',
        claudeVersion: '2.1.287',
        error: null,
        accounts: [
          {
            name: 'Misc',
            email: 'a@b.c',
            signedIn: true,
            sessions: [session(), session({ id: 's2', title: 'Two', running: false, cwd: null })],
          },
        ],
      },
      {
        id: 'h2',
        label: 'NAS',
        address: null,
        serverVersion: null,
        claudeVersion: null,
        error: 'no address answered',
        accounts: [],
      },
    ],
  })
  expect(text).toBe(
    ['xjopa1 (server 0.6.3)', '  Misc <a@b.c>', '    ● One  ~/one', '    ○ Two', 'NAS: no address answered'].join('\n'),
  )
})
