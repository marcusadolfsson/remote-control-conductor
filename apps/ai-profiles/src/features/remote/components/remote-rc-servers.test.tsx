import type { RcServer, RemoteHost } from '@/lib/types'

import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { openExternalUrl, remoteListRcServers, remoteOpenInTerminal, remoteStopRcServer } from '@/lib/commands'
import { renderWithQuery } from '@/test/render-with-query'

import { RemoteRcServers } from './remote-rc-servers'

vi.mock('@/lib/commands', async () => {
  const actual = await vi.importActual<typeof import('@/lib/commands')>('@/lib/commands')
  return {
    ...actual,
    remoteListRcServers: vi.fn(),
    remoteStopRcServer: vi.fn(async () => true),
    remoteOpenInTerminal: vi.fn(async () => null),
    openExternalUrl: vi.fn(async () => {}),
  }
})

const host: RemoteHost = {
  id: 'h1',
  label: 'xjopa1',
  hostname: 'xjopa1',
  addresses: ['100.110.48.97:7443'],
  fingerprint: 'ab'.repeat(32),
  clientId: 'c1',
  pairedAt: '2026-09-22T00:00:00Z',
  lastGoodAddress: '100.110.48.97:7443',
  profiles: {},
}

function server(overrides: Partial<RcServer> = {}): RcServer {
  return {
    pid: 4121,
    folder: '/home/marcus/proj',
    name: 'proj (xJOPA)',
    spawn: 'worktree',
    sessions: 2,
    window: { session: 'ai', windowId: '@9', paneId: '%9' },
    environmentUrl: 'https://claude.ai/code?environment=env_01abc',
    attention: null,
    ...overrides,
  }
}

describe('RemoteRcServers', () => {
  beforeEach(() => vi.clearAllMocks())

  it('lists a profile’s servers, opens one on claude.ai, and stops one after asking', async () => {
    vi.mocked(remoteListRcServers).mockResolvedValue([server()])
    renderWithQuery(<RemoteRcServers host={host} account="Misc" home="/home/marcus" />)

    expect(await screen.findByText('proj (xJOPA)')).toBeInTheDocument()
    expect(screen.getByText(/~\/proj · a worktree per session · 2 sessions/)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Open' }))
    expect(openExternalUrl).toHaveBeenCalledWith('https://claude.ai/code?environment=env_01abc')

    await userEvent.click(screen.getByRole('button', { name: 'Open its window in Terminal' }))
    expect(remoteOpenInTerminal).toHaveBeenCalledWith({
      hostId: 'h1',
      attachCommand: 'tmux attach -t ai \\; select-window -t @9',
    })

    await userEvent.click(screen.getByRole('button', { name: 'Stop' }))
    expect(await screen.findByText('Stop this Remote Control server?')).toBeInTheDocument()
    expect(screen.getByText(/the 2 sessions it serves stop answering/)).toBeInTheDocument()
    const stops = screen.getAllByRole('button', { name: /^Stop/ })
    await userEvent.click(stops[stops.length - 1] as HTMLElement)
    expect(remoteStopRcServer).toHaveBeenCalledWith({ hostId: 'h1', account: 'Misc', pid: 4121 })
  })

  it('offers no Stop for a server started elsewhere, and says what one waits on', async () => {
    vi.mocked(remoteListRcServers).mockResolvedValue([
      server({ pid: 1, folder: '/home/marcus/other', name: null, window: null, environmentUrl: null }),
      server({ pid: 2, attention: { kind: 'enableRemoteControl', text: 'Answer it in the window.' } }),
    ])
    renderWithQuery(<RemoteRcServers host={host} account="Misc" home="/home/marcus" />)

    expect(await screen.findByText('other')).toBeInTheDocument()
    expect(screen.getByText(/started elsewhere/)).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Stop' })).toHaveLength(1)
    expect(screen.getByText('Answer it in the window.')).toBeInTheDocument()
  })

  it('shows nothing on a host too old to have servers', async () => {
    vi.mocked(remoteListRcServers).mockRejectedValue({ kind: 'remote', message: 'HTTP 404' })
    const { container } = renderWithQuery(<RemoteRcServers host={host} account="Misc" />)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(container).toBeEmptyDOMElement()
  })
})
