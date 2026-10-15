import { invoke } from '@tauri-apps/api/core'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { attachCommand } from '@/features/remote/lib/tmux-attach'

import {
  remoteListDirs,
  remoteListRcServers,
  remoteStartRcServer,
  remoteStopRcServer,
  remoteWindowKeys,
} from './commands'
import { localHost } from './local-host'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => null) }))

describe('this Mac as a host', () => {
  beforeEach(() => vi.clearAllMocks())

  it('starts, lists and stops its servers through the app, by profile, not a host', async () => {
    await remoteListRcServers({ hostId: localHost.id, account: 'default:claude' })
    expect(invoke).toHaveBeenLastCalledWith('local_list_rc_servers', { profileId: 'default:claude' })
    const request = { folder: '/Users/m/code', spawn: 'same-dir' as const, trustFolder: true }
    await remoteStartRcServer({ hostId: localHost.id, account: 'abc', request })
    expect(invoke).toHaveBeenLastCalledWith('local_start_rc_server', { profileId: 'abc', request })
    await remoteStopRcServer({ hostId: localHost.id, account: 'abc', pid: 812 })
    expect(invoke).toHaveBeenLastCalledWith('local_stop_rc_server', { profileId: 'abc', pid: 812 })
  })

  it('browses and types into windows on this Mac', async () => {
    await remoteListDirs({ hostId: localHost.id })
    expect(invoke).toHaveBeenLastCalledWith('local_list_dirs', { path: null })
    const keys = [{ key: 'Enter' }]
    await remoteWindowKeys({ hostId: localHost.id, account: 'abc', windowId: '@4', keys })
    expect(invoke).toHaveBeenLastCalledWith('local_window_keys', { windowId: '@4', keys })
  })

  it('leaves a paired host’s calls as they were', async () => {
    await remoteListRcServers({ hostId: 'h1', account: 'Misc' })
    expect(invoke).toHaveBeenLastCalledWith('remote_list_rc_servers', { hostId: 'h1', account: 'Misc' })
  })

  it('attaches to its windows with tmux alone, no ssh', () => {
    const window = { session: 'rc', windowId: '@4', paneId: '%7' }
    expect(attachCommand(localHost, { window })).toBe(String.raw`tmux attach -t rc \; select-window -t @4`)
  })
})
