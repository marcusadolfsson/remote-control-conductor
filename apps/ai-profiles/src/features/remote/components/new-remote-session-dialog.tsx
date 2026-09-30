import type { DirListing, RemoteHost, RemoteLaunch } from '@/lib/types'

import { useEffect, useState } from 'react'

import { ChevronLeft, Folder } from 'lucide-react'

import { Button, Dialog, Kbd } from '@/design'
import { Input } from '@/design/ui/input'
import { sessionErrorMessage } from '@/features/profiles/components/session-error-message'
import { shortenHomePath } from '@/features/profiles/components/shorten-home-path'

import { useNewRemoteSession, useRemoteDirs } from '../api/use-remote'

type Props = {
  open: boolean
  host: RemoteHost
  account: string
  /** Folders the account's sessions worked in, most recent first. */
  recentFolders: Array<string>
  onClose: () => void
  onStarted: (launch: RemoteLaunch) => void
}

/** The last part of a path: `david` for `/home/marcus/david`. */
function folderName(path: string): string {
  return path.split('/').filter(Boolean).pop() ?? ''
}

const labelClasses = 'mb-1.5 block font-mono text-[11.5px] font-medium uppercase tracking-[0.08em] text-muted'

/**
 * Starting a Claude session on a remote host: pick a folder there, maybe
 * name the session (its Remote Control name), and it opens in the host's
 * tmux with Remote Control on.
 */
export function NewRemoteSessionDialog({ open, host, account, recentFolders, onClose, onStarted }: Props) {
  // null: the host's home, which the first listing resolves.
  const [path, setPath] = useState<string | null>(null)
  const [name, setName] = useState('')
  // Until someone types a name, the session is named after its folder.
  const [nameTyped, setNameTyped] = useState(false)
  const [trust, setTrust] = useState(true)
  const dirs = useRemoteDirs(host.id, path, open)
  const start = useNewRemoteSession(host.id, account)

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset each time the dialog opens
  useEffect(() => {
    if (open) {
      setPath(null)
      setName('')
      setNameTyped(false)
      setTrust(true)
      start.reset()
    }
  }, [open])

  const folder = dirs.data?.path ?? null
  const ready = folder !== null && !start.isPending

  useEffect(() => {
    if (!nameTyped && folder !== null) {
      setName(folderName(folder))
    }
  }, [folder, nameTyped])

  async function handleStart() {
    if (!ready || folder === null) {
      return
    }
    try {
      const launch = await start.mutateAsync({ cwd: folder, name: name.trim() || undefined, trustFolder: trust })
      onStarted(launch)
      onClose()
    } catch {
      // Shown below.
    }
  }

  return (
    <Dialog
      open={open}
      title="New session"
      description={`${account} on ${host.label}. It opens in tmux with Remote Control on.`}
      onClose={onClose}
      onSubmit={handleStart}
      closeOnOutsideClick={false}
      foot={<StartFoot ready={ready} starting={start.isPending} onCancel={onClose} onStart={handleStart} />}
    >
      <div className="space-y-4">
        <FolderPicker
          listing={dirs.data}
          error={dirs.isError ? dirs.error : null}
          recentFolders={recentFolders}
          onPath={setPath}
        />
        <SessionNameField
          name={name}
          onNameChange={(typed) => {
            setName(typed)
            setNameTyped(true)
          }}
        />
        <TrustFolderField trust={trust} onTrustChange={setTrust} />
        {start.isError ? (
          <p role="alert" className="whitespace-pre-line text-meta text-red">
            {sessionErrorMessage(start.error, 'The session could not be started.')}
          </p>
        ) : null}
      </div>
    </Dialog>
  )
}

type StartFootProps = {
  /**
   * Whether a folder is picked and nothing is starting yet.
   */
  ready: boolean
  /**
   * Whether the session is starting now.
   */
  starting: boolean
  /**
   * Closes without starting.
   */
  onCancel: () => void
  /**
   * Starts the session.
   */
  onStart: () => void
}

/**
 * The dialog's buttons.
 */
function StartFoot({ ready, starting, onCancel, onStart }: StartFootProps) {
  return (
    <>
      <Button variant="ghost" size="sm" trailingKbd={<Kbd>⎋</Kbd>} disabled={starting} onClick={onCancel}>
        Cancel
      </Button>
      <Button
        variant="primary"
        size="sm"
        trailingKbd={<Kbd variant="onOrange">⏎</Kbd>}
        disabled={!ready}
        onClick={onStart}
      >
        {starting ? 'Starting…' : 'Start'}
      </Button>
    </>
  )
}

type FolderPickerProps = {
  /**
   * The folder shown and what's in it, once the host has listed it.
   */
  listing: DirListing | undefined
  /**
   * Why the host couldn't list it, if it couldn't.
   */
  error: unknown
  /**
   * Folders the account's sessions worked in, most recent first.
   */
  recentFolders: Array<string>
  /**
   * Goes to another folder.
   */
  onPath: (path: string) => void
}

/**
 * Walking the host's folders to the one to start in, or jumping to a recent
 * one.
 */
function FolderPicker({ listing, error, recentFolders, onPath }: FolderPickerProps) {
  const folder = listing?.path ?? null
  const parent = listing?.parent ?? null
  return (
    <div>
      <span className={labelClasses}>Folder</span>
      <div className="rounded-[10px] border border-border-soft bg-white/30 dark:bg-white/[0.02]">
        <div className="flex items-center gap-2 border-b border-border-soft px-[11px] py-[7px]">
          <Button
            variant="ghost"
            size="sm"
            aria-label="Up one folder"
            disabled={!parent}
            onClick={() => parent && onPath(parent)}
          >
            <ChevronLeft aria-hidden className="h-3.5 w-3.5" />
          </Button>
          <span className="truncate font-mono text-mono text-ink-soft" title={folder ?? undefined}>
            {folder ? shortenHomePath(folder, listing?.home) : '…'}
          </span>
        </div>
        <ul aria-label="Subfolders" className="max-h-[180px] overflow-y-auto py-1">
          <Subfolders listing={listing} error={error} onPath={onPath} />
        </ul>
      </div>
      <RecentFolders recentFolders={recentFolders} home={listing?.home} onPath={onPath} />
    </div>
  )
}

type SubfoldersProps = {
  /**
   * The folder shown and what's in it, once listed.
   */
  listing: DirListing | undefined
  /**
   * Why it couldn't be listed, if it couldn't.
   */
  error: unknown
  /**
   * Goes into a subfolder.
   */
  onPath: (path: string) => void
}

/**
 * The folders inside the one shown, as list items.
 */
function Subfolders({ listing, error, onPath }: SubfoldersProps) {
  if (error) {
    return <li className="px-[13px] py-1.5 text-meta text-red">{sessionErrorMessage(error)}</li>
  }
  if (listing?.entries.length === 0) {
    return <li className="px-[13px] py-1.5 text-meta text-muted">No folders inside. Start here, or go up.</li>
  }
  return (
    <>
      {(listing?.entries ?? []).map((entry) => (
        <li key={entry.path}>
          <button
            type="button"
            className="flex w-full cursor-pointer items-center gap-2 px-[13px] py-1 text-left text-body text-ink-soft hover:bg-white/50 dark:hover:bg-white/[0.04]"
            onClick={() => onPath(entry.path)}
          >
            <Folder aria-hidden className="h-3.5 w-3.5 shrink-0 text-muted" />
            <span className="truncate">{entry.name}</span>
          </button>
        </li>
      ))}
      {listing?.truncated ? (
        <li className="px-[13px] py-1 text-meta text-muted">Only the first 500 are listed.</li>
      ) : null}
    </>
  )
}

type RecentFoldersProps = {
  /**
   * Folders the account's sessions worked in, most recent first.
   */
  recentFolders: Array<string>
  /**
   * The host's home, to shorten paths by.
   */
  home: string | undefined
  /**
   * Goes to one of them.
   */
  onPath: (path: string) => void
}

/**
 * The last few folders the account's sessions worked in, a click away.
 */
function RecentFolders({ recentFolders, home, onPath }: RecentFoldersProps) {
  if (recentFolders.length === 0) {
    return null
  }
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      <span className="text-meta text-muted">Recent:</span>
      {recentFolders.slice(0, 5).map((recent) => (
        <button
          key={recent}
          type="button"
          title={recent}
          className="max-w-[180px] cursor-pointer truncate rounded-[5px] border border-border-soft px-1.5 py-px font-mono text-[11px] text-muted-strong hover:border-border-strong hover:text-ink"
          onClick={() => onPath(recent)}
        >
          {shortenHomePath(recent, home)}
        </button>
      ))}
    </div>
  )
}

/**
 * The session's name, which Remote Control, the tmux window and the list
 * show.
 */
function SessionNameField({ name, onNameChange }: { name: string; onNameChange: (name: string) => void }) {
  return (
    <div>
      <label htmlFor="remote-session-name" className={labelClasses}>
        Name <span className="normal-case tracking-normal text-muted">(optional)</span>
      </label>
      <Input
        id="remote-session-name"
        value={name}
        maxLength={100}
        onChange={(event) => onNameChange(event.target.value)}
        placeholder="Named by Remote Control"
        autoComplete="off"
        spellCheck={false}
      />
      <p className="mt-1 text-meta text-muted">
        What Remote Control, the tmux window and this list call it. The folder's name unless you change it.
      </p>
    </div>
  )
}

/**
 * Whether to answer Claude's folder trust question for the user.
 */
function TrustFolderField({ trust, onTrustChange }: { trust: boolean; onTrustChange: (trust: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-start gap-2 text-body text-ink-soft">
      <input
        type="checkbox"
        checked={trust}
        onChange={(event) => onTrustChange(event.target.checked)}
        className="mt-[3px] h-4 w-4 cursor-pointer accent-orange"
      />
      <span>
        Trust this folder
        <span className="block text-meta text-muted">
          Answers Claude's "do you trust this folder?" question for you. Remote Control can't connect until it's
          answered.
        </span>
      </span>
    </label>
  )
}
