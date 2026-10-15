import type { RcServer, RemoteHost, RemoteSession } from '@/lib/types'
import type { RemoteControlSession } from '../api/use-remote'

import { describe, expect, it } from 'vitest'

import { byServer } from './connected'

const host = { id: 'h1', label: 'atlas' } as RemoteHost
const server = (pid: number) => ({ pid, folder: `/w/${pid}` }) as RcServer

const connected = (id: string, on: RcServer | null, account = 'work'): RemoteControlSession => ({
  host,
  account,
  email: 'ada@example.com',
  session: { id } as RemoteSession,
  server: on,
})

describe('byServer', () => {
  it('groups by server in the order they come, then the rest', () => {
    const a = server(1)
    const b = server(2)
    const groups = byServer([
      connected('cli', null),
      connected('b1', b),
      connected('a1', a),
      connected('b2', b),
      connected('other', a, 'home'),
    ])
    expect(groups.map((g) => [g.key, g.sessions.map((s) => s.session.id)])).toEqual([
      ['h1/work/2', ['b1', 'b2']],
      ['h1/work/1', ['a1']],
      ['h1/home/1', ['other']],
      [null, ['cli']],
    ])
  })

  it('has no empty rest', () => {
    expect(byServer([connected('a1', server(1))]).map((g) => g.key)).toEqual(['h1/work/1'])
  })
})
