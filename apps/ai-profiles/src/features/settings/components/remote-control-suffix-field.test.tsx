import type { HostInfo, RemoteHost } from '@/lib/types'

import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { remoteSetHostSettings } from '@/lib/commands'
import { renderWithQuery } from '@/test/render-with-query'

import { RemoteControlSuffixField } from './remote-control-suffix-field'

vi.mock('@/lib/commands', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/commands')>()
  return { ...actual, remoteSetHostSettings: vi.fn() }
})

const host: RemoteHost = {
  id: 'h1',
  label: 'xjopa1',
  hostname: 'xjopa1',
  addresses: ['100.64.0.1:7443'],
  fingerprint: 'ab',
  clientId: 'c1',
  pairedAt: '2026-09-22T00:00:00Z',
  lastGoodAddress: null,
  profiles: {},
}

function info(overrides: Partial<HostInfo> = {}): HostInfo {
  return {
    hostname: 'xjopa1',
    home: '/home/marcus',
    serverVersion: '0.6.3',
    apiVersion: 1,
    tmux: { version: 'tmux 3.4', session: 'ai' },
    claude: { path: '/home/marcus/.local/bin/claude', version: '2.1.285' },
    accountsBase: '/home/marcus/.claude-accounts',
    includesDefault: false,
    settings: { remoteControlSuffix: null },
    ...overrides,
  }
}

beforeEach(() => {
  vi.mocked(remoteSetHostSettings).mockReset()
  vi.mocked(remoteSetHostSettings).mockImplementation(async ({ remoteControlSuffix }) => ({ remoteControlSuffix }))
})

describe('RemoteControlSuffixField', () => {
  it("adds the host's name to Remote Control names when turned on", async () => {
    renderWithQuery(<RemoteControlSuffixField host={host} info={info()} />)
    const name = screen.getByRole('textbox', { name: /Name added to xjopa1/ })
    expect(name).toHaveValue('xjopa1')
    expect(name).toBeDisabled()
    await userEvent.setup().click(screen.getByRole('checkbox', { name: /Add to Remote Control names/ }))
    await waitFor(() =>
      expect(remoteSetHostSettings).toHaveBeenCalledWith({ hostId: 'h1', remoteControlSuffix: 'xjopa1' }),
    )
  })

  it('saves another name, and stops when turned off', async () => {
    const user = userEvent.setup()
    renderWithQuery(
      <RemoteControlSuffixField host={host} info={info({ settings: { remoteControlSuffix: 'xJOPA' } })} />,
    )
    const name = screen.getByRole('textbox', { name: /Name added to xjopa1/ })
    expect(name).toHaveValue('xJOPA')
    await user.clear(name)
    await user.type(name, 'cloud{Enter}')
    await waitFor(() =>
      expect(remoteSetHostSettings).toHaveBeenCalledWith({ hostId: 'h1', remoteControlSuffix: 'cloud' }),
    )
    await user.click(screen.getByRole('checkbox', { name: /Add to Remote Control names/ }))
    await waitFor(() =>
      expect(remoteSetHostSettings).toHaveBeenLastCalledWith({ hostId: 'h1', remoteControlSuffix: null }),
    )
  })

  it('asks for a newer server when the host has an older one', () => {
    renderWithQuery(<RemoteControlSuffixField host={host} info={info({ settings: null })} />)
    expect(screen.getByText(/Update the server on xjopa1/)).toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).toBeNull()
  })
})
