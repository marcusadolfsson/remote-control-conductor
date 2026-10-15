import type { SharingStatus } from '@/lib/types'

import { Suspense } from 'react'

import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { sharingForget, sharingNewCode, sharingSetEnabled, sharingStatus } from '@/lib/commands'
import { renderWithQuery } from '@/test/render-with-query'

import { ShareThisMacSection } from './share-this-mac-section'

vi.mock('@/lib/commands', async () => {
  const actual = await vi.importActual<typeof import('@/lib/commands')>('@/lib/commands')
  return {
    ...actual,
    sharingStatus: vi.fn(),
    sharingSetEnabled: vi.fn(),
    sharingNewCode: vi.fn(),
    sharingForget: vi.fn(),
    copyToClipboard: vi.fn(async () => {}),
  }
})

const off: SharingStatus = { enabled: false, listening: false, error: null, port: 7443, clients: [] }
const on: SharingStatus = {
  ...off,
  enabled: true,
  listening: true,
  clients: [{ id: 'c1', name: 'Mac mini', pairedAt: '2026-10-15T12:00:00Z' }],
}

function renderSection() {
  renderWithQuery(
    <Suspense fallback={null}>
      <ShareThisMacSection />
    </Suspense>,
  )
}

beforeEach(() => {
  vi.mocked(sharingStatus).mockResolvedValue(off)
  vi.mocked(sharingSetEnabled).mockResolvedValue(on)
  vi.mocked(sharingForget).mockResolvedValue({ ...on, clients: [] })
  vi.mocked(sharingNewCode).mockResolvedValue({
    code: 'aip1.abc',
    hosts: ['100.1.2.3:7443', 'macbook:7443'],
    fingerprint: 'AB:CD',
  })
})

describe('ShareThisMacSection', () => {
  it('shares the Mac, then makes a pairing code', async () => {
    renderSection()
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Share' }))
    expect(sharingSetEnabled).toHaveBeenCalledWith(true, expect.anything())
    expect(await screen.findByText('Answering on port 7443.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'New pairing code' }))
    expect(await screen.findByRole('button', { name: 'Copy aip1.abc' })).toBeInTheDocument()
    expect(screen.getByText(/100\.1\.2\.3:7443 or macbook:7443/)).toBeInTheDocument()
  })

  it('says why it is not answering, and unpairs a Mac', async () => {
    vi.mocked(sharingStatus).mockResolvedValue({ ...on, listening: false, error: 'Port 7443 is taken.' })
    renderSection()
    const user = userEvent.setup()
    expect(await screen.findByRole('alert')).toHaveTextContent('Port 7443 is taken.')
    await user.click(screen.getByRole('button', { name: 'Unpair' }))
    expect(sharingForget).toHaveBeenCalledWith('c1', expect.anything())
    expect(await screen.findByRole('button', { name: 'Stop sharing' })).toBeInTheDocument()
  })
})
