import type { RcServer, RemoteHost } from '@/lib/types'

import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ToastProvider } from '@/design'
import { openExternalUrl, remoteListRcServers, remoteStopRcServer, remoteWindowScreen } from '@/lib/commands'
import { renderWithQuery } from '@/test/render-with-query'

import { RemoteRcServers } from './remote-rc-servers'

vi.mock('@/lib/commands', async () => {
  const actual = await vi.importActual<typeof import('@/lib/commands')>('@/lib/commands')
  return {
    ...actual,
    remoteListRcServers: vi.fn(),
    remoteStopRcServer: vi.fn(async () => true),
    remoteOpenInTerminal: vi.fn(async () => null),
    remoteWindowScreen: vi.fn(async () => ({
      text: 'Trust /home/marcus/proj? [y/N]',
      width: 80,
      height: 24,
      remoteControl: false,
      sessionId: null,
    })),
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
    renderWithQuery(
      <ToastProvider>
        <RemoteRcServers host={host} account="Misc" home="/home/marcus" />
      </ToastProvider>,
    )

    expect(await screen.findByText('proj (xJOPA)')).toBeInTheDocument()
    expect(screen.getByText(/~\/proj · a worktree per session · 2 sessions/)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Open' }))
    expect(openExternalUrl).toHaveBeenCalledWith('https://claude.ai/code?environment=env_01abc')

    // Its window opens here, live, as a session's does.
    await userEvent.click(screen.getByRole('button', { name: 'Open its window' }))
    expect(await screen.findByText(/Trust \/home\/marcus\/proj\? \[y\/N\]/)).toBeInTheDocument()
    expect(remoteWindowScreen).toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Close' }))

    await userEvent.click(screen.getByRole('button', { name: 'Stop' }))
    expect(await screen.findByText('Stop this Remote Control server?')).toBeInTheDocument()
    expect(screen.getByText(/the 2 sessions it serves stop answering/)).toBeInTheDocument()
    const stops = screen.getAllByRole('button', { name: /^Stop/ })
    await userEvent.click(stops[stops.length - 1] as HTMLElement)
    expect(remoteStopRcServer).toHaveBeenCalledWith({ hostId: 'h1', account: 'Misc', pid: 4121 })
  })

  it('lists the sessions a server serves under it', async () => {
    vi.mocked(remoteListRcServers).mockResolvedValue([server(), server({ pid: 7, folder: '/home/marcus/idle' })])
    renderWithQuery(
      <RemoteRcServers
        host={host}
        account="Misc"
        sessionsOf={(one) => (one.pid === 4121 ? [<li key="s1">Fix the build</li>] : undefined)}
      />,
    )

    const served = await screen.findByRole('list', { name: 'Sessions it serves' })
    expect(served).toHaveTextContent('Fix the build')
    expect(screen.getAllByRole('list', { name: 'Sessions it serves' })).toHaveLength(1)
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

  it('offers Start… even with none, where servers can be started from here', async () => {
    vi.mocked(remoteListRcServers).mockResolvedValue([])
    const onStart = vi.fn()
    renderWithQuery(<RemoteRcServers host={host} account="default:claude" onStart={onStart} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Start…' }))
    expect(onStart).toHaveBeenCalled()
    expect(screen.queryByRole('list', { name: 'Remote Control servers' })).not.toBeInTheDocument()
  })
})
