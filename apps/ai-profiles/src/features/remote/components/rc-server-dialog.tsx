import type { RcServer, RemoteHost, RemoteSession } from '@/lib/types'

import { useEffect, useState } from 'react'

import { Dialog } from '@/design'
import { Input } from '@/design/ui/input'
import { sessionErrorMessage } from '@/features/profiles/components/session-error-message'
import { shortenHomePath } from '@/features/profiles/components/shorten-home-path'

import { useRemoteRcServers, useStartRcServer } from '../api/use-remote'
import {
  folderName,
  labelClasses,
  PickedFolder,
  StartFoot,
  TrustFolderField,
  useFolderPick,
} from './new-remote-session-dialog'

type Spawn = 'same-dir' | 'worktree'

type RcServerDialogProps = {
  /** Whether it shows. */
  open: boolean
  /** The host to start it on. */
  host: RemoteHost
  /** The profile it runs as. */
  account: string
  /** The folder to open on (a session's), or null for the host's home. */
  initialFolder: string | null
  /** Folders the profile's sessions worked in, most recent first. */
  recentFolders: Array<string>
  /** Closes it. */
  onClose: () => void
}

/**
 * Starting a Remote Control server (`claude remote-control`) in a folder on a
 * host, so the Claude apps can start new sessions there: pick the folder, how
 * its sessions are placed, and maybe a name.
 */
export function RcServerDialog({ open, host, account, initialFolder, recentFolders, onClose }: RcServerDialogProps) {
  const pick = useFolderPick(host.id, open, initialFolder)
  const [spawn, setSpawn] = useState<Spawn>('same-dir')
  const servers = useRemoteRcServers(host.id, account)
  const start = useStartRcServer(host.id, account)

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset each time the dialog opens
  useEffect(() => {
    if (open) {
      setSpawn('same-dir')
      start.reset()
    }
  }, [open])

  const folder = pick.folder
  const running = servers.data?.find((server) => server.folder === folder)
  const ready = folder !== null && !running && !start.isPending

  async function handleStart() {
    if (!ready || folder === null) {
      return
    }
    try {
      await start.mutateAsync({ folder, name: pick.name.trim() || undefined, spawn, trustFolder: pick.trust })
      onClose()
    } catch {
      // Shown below.
    }
  }

  return (
    <Dialog
      open={open}
      title="Remote Control server"
      description={`${account} on ${host.label}. The Claude apps on your other devices can start new sessions in its folder.`}
      onClose={onClose}
      onSubmit={handleStart}
      closeOnOutsideClick={false}
      foot={<StartFoot ready={ready} starting={start.isPending} onCancel={onClose} onStart={handleStart} />}
    >
      <div className="space-y-4">
        <PickedFolder pick={pick} recentFolders={recentFolders} />
        <RunningNotice server={running} home={pick.dirs.data?.home} />
        <SpawnField spawn={spawn} onSpawnChange={setSpawn} />
        <ServerNameField name={pick.name} onNameChange={pick.typeName} />
        <TrustFolderField trust={pick.trust} onTrustChange={pick.setTrust} />
        {start.isError ? (
          <p role="alert" className="whitespace-pre-line text-meta text-red">
            {sessionErrorMessage(start.error, 'The Remote Control server could not be started.')}
          </p>
        ) : null}
      </div>
    </Dialog>
  )
}

/**
 * "Remote Control server here…" on a session: offered for a folder no server
 * runs in, on a host new enough to have them, opening the dialog on it.
 */
export function useServerHere(hostId: string, account: string) {
  const [folder, setFolder] = useState<string | null>(null)
  const servers = useRemoteRcServers(hostId, account)
  const offer = (session: RemoteSession) => {
    const cwd = session.cwd
    const offered = servers.isSuccess && cwd !== null && !servers.data.some((server) => server.folder === cwd)
    return offered ? () => setFolder(cwd) : undefined
  }
  return { folder, offer, close: () => setFolder(null) }
}

type ServerHereDialogProps = {
  /** The host the session is on. */
  host: RemoteHost
  /** Its profile. */
  account: string
  /** The folder offered, from {@link useServerHere}. */
  here: ReturnType<typeof useServerHere>
}

/** The dialog a session's "Remote Control server here…" opens, on its folder. */
export function ServerHereDialog({ host, account, here }: ServerHereDialogProps) {
  return (
    <RcServerDialog
      open={here.folder !== null}
      host={host}
      account={account}
      initialFolder={here.folder}
      recentFolders={here.folder ? [here.folder] : []}
      onClose={here.close}
    />
  )
}

type RunningNoticeProps = {
  /** The server running in the folder picked, if any. */
  server: RcServer | undefined
  /** The host's home, to shorten its folder by. */
  home: string | undefined
}

/** A server already runs in the folder: nothing to start. */
function RunningNotice({ server, home }: RunningNoticeProps) {
  if (!server) {
    return null
  }
  return (
    <p className="rounded-[10px] border border-border-soft px-[13px] py-[10px] text-meta text-ink-soft">
      {server.name ?? folderName(server.folder)} already serves {shortenHomePath(server.folder, home)}, with{' '}
      {server.sessions} {server.sessions === 1 ? 'session' : 'sessions'}. Start sessions there from claude.ai or the
      Claude app.
    </p>
  )
}

type SpawnFieldProps = {
  /** How its sessions are placed. */
  spawn: Spawn
  /** Changes that. */
  onSpawnChange: (spawn: Spawn) => void
}

const spawnChoices: Array<{ value: Spawn; label: string; hint: string }> = [
  {
    value: 'same-dir',
    label: 'In this folder',
    hint: 'Every session works in the folder, so two can edit the same files.',
  },
  {
    value: 'worktree',
    label: 'Each in a git worktree of its own',
    hint: "Sessions don't step on each other's files. The folder must be a git repository.",
  },
]

/** Where the sessions the server starts work. */
function SpawnField({ spawn, onSpawnChange }: SpawnFieldProps) {
  return (
    <fieldset>
      <legend className={labelClasses}>Sessions</legend>
      <div className="space-y-2">
        {spawnChoices.map((choice) => (
          <label key={choice.value} className="flex cursor-pointer items-start gap-2 text-body text-ink-soft">
            <input
              type="radio"
              name="rc-server-spawn"
              checked={spawn === choice.value}
              onChange={() => onSpawnChange(choice.value)}
              className="mt-[3px] h-4 w-4 cursor-pointer accent-orange"
            />
            <span>
              {choice.label}
              <span className="block text-meta text-muted">{choice.hint}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}

type ServerNameFieldProps = {
  /** The name as typed. */
  name: string
  /** Changes it. */
  onNameChange: (name: string) => void
}

/** What the Claude apps call the server. */
function ServerNameField({ name, onNameChange }: ServerNameFieldProps) {
  return (
    <div>
      <label htmlFor="rc-server-name" className={labelClasses}>
        Name <span className="normal-case tracking-normal text-muted">(optional)</span>
      </label>
      <Input
        id="rc-server-name"
        value={name}
        maxLength={100}
        onChange={(event) => onNameChange(event.target.value)}
        placeholder="The folder's name"
        autoComplete="off"
        spellCheck={false}
      />
      <p className="mt-1 text-meta text-muted">What the Claude apps call it. The folder's name unless you change it.</p>
    </div>
  )
}
