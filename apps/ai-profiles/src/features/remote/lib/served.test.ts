import type { RcServer, RemoteSession } from '@/lib/types'

import { describe, expect, it } from 'vitest'

import { groupByServer, servingServer } from './served'

const server = (pid: number, folder: string) => ({ pid, folder, spawn: 'same-dir', sessions: 0 }) as RcServer

const session = (id: string, cwd: string, over: Partial<RemoteSession> = {}) =>
  ({ id, cwd, running: true, served: false, ...over }) as RemoteSession

describe('groupByServer', () => {
  it('puts served sessions under their server, and keeps the CLI and stopped ones apart', () => {
    const servers = [server(1, '/www/vb4'), server(2, '/www/vb4/sub')]
    const sessions = [
      session('cli', '/www/vb4'),
      session('served', '/www/vb4', { served: true }),
      session('worktree', '/www/vb4/.claude/worktrees/a1', { served: true }),
      session('nested', '/www/vb4/sub', { served: true }),
      session('stopped', '/www/vb4', { served: true, running: false }),
      session('sibling', '/www/vb40', { served: true }),
    ]
    const { byServer, rest } = groupByServer(sessions, servers)
    expect(byServer.get(1)?.map((s) => s.id)).toEqual(['served', 'worktree'])
    expect(byServer.get(2)?.map((s) => s.id)).toEqual(['nested'])
    expect(rest.map((s) => s.id)).toEqual(['cli', 'stopped', 'sibling'])
  })

  it('keeps every session when no servers are known', () => {
    const served = session('served', '/www/vb4', { served: true })
    expect(servingServer(served, [])).toBeUndefined()
    expect(groupByServer([served], null).rest).toEqual([served])
  })
})
