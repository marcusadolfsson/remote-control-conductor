import type {
  NewRemoteSession,
  RcServer,
  RemoteAccount,
  RemoteHost,
  RemoteSession,
  RemoteTransferRequest,
  StartRcServer,
} from '@/lib/types'

import { useEffect, useRef } from 'react'

import { useMutation, useQueries, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'

import { presetColors } from '@/lib/colors'
import {
  remoteArchivedSessions,
  remoteArchiveSession,
  remoteDeleteAccount,
  remoteDeleteArchive,
  remoteHostInfo,
  remoteListAccounts,
  remoteListDirs,
  remoteListHosts,
  remoteListRcServers,
  remoteListSessions,
  remoteLoginCancel,
  remoteLoginStart,
  remoteLoginSubmit,
  remoteLogout,
  remoteMergeMemory,
  remoteNewSession,
  remotePairHost,
  remoteRemoveHost,
  remoteRenameAccount,
  remoteRenameHost,
  remoteRenameSession,
  remoteRestartSession,
  remoteRestoreSession,
  remoteResumeSession,
  remoteSetHostSettings,
  remoteSetProfileColor,
  remoteStartRcServer,
  remoteStopRcServer,
  remoteStopSession,
  remoteTransferPlan,
  remoteTransferProgress,
  remoteTransferSession,
} from '@/lib/commands'
import { queryKeys } from '@/lib/query/keys'

import { servingServer } from '../lib/served'

/**
 * The paired hosts. A local file, so it suspends like the profile list.
 */
export function useRemoteHosts(): Array<RemoteHost> {
  const { data } = useSuspenseQuery({
    queryKey: queryKeys.remote.hosts,
    queryFn: remoteListHosts,
  })
  return data
}

/**
 * What a host is and runs. Its failing is how the app tells a host is
 * offline, so it isn't retried: the next focus or interval tries again.
 */
export function useRemoteHostInfo(hostId: string) {
  return useQuery({
    queryKey: queryKeys.remote.info(hostId),
    queryFn: () => remoteHostInfo(hostId),
    retry: 0,
    refetchOnWindowFocus: 'always',
    refetchInterval: 60_000,
    staleTime: 30_000,
  })
}

/** A host's Claude accounts, refreshed every minute and on focus. */
export function useRemoteAccounts(hostId: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.remote.accounts(hostId),
    queryFn: () => remoteListAccounts(hostId),
    enabled,
    retry: 0,
    refetchOnWindowFocus: 'always',
    refetchInterval: 60_000,
  })
}

/**
 * An account's sessions. Sessions start and stop on the host by themselves,
 * so this is polled more often than the account list.
 */
export function useRemoteSessions(hostId: string, account: string) {
  return useQuery({
    queryKey: queryKeys.remote.sessions(hostId, account),
    queryFn: () => remoteListSessions({ hostId, account }),
    retry: 0,
    refetchOnWindowFocus: 'always',
    // Sooner while Remote Control is connecting, so Open in Claude shows
    // once it can.
    refetchInterval: (query) => (query.state.data?.some((session) => session.remoteControlConnecting) ? 3_000 : 15_000),
  })
}

/**
 * A profile's Remote Control servers. A host too old to have them fails, which
 * is how the app knows to leave them out.
 */
export function useRemoteRcServers(hostId: string, account: string) {
  return useQuery({
    queryKey: queryKeys.remote.rcServers(hostId, account),
    queryFn: () => remoteListRcServers({ hostId, account }),
    retry: 0,
    refetchOnWindowFocus: 'always',
    refetchInterval: 15_000,
  })
}

/** Start a Remote Control server, then read the servers and sessions again. */
export function useStartRcServer(hostId: string, account: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (request: StartRcServer) => remoteStartRcServer({ hostId, account, request }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['remote', hostId, 'accounts', account] }),
  })
}

/** Stop a Remote Control server, then read the servers and sessions again. */
export function useStopRcServer(hostId: string, account: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (pid: number) => remoteStopRcServer({ hostId, account, pid }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['remote', hostId, 'accounts', account] }),
  })
}

/**
 * Restart a Remote Control server on the Claude Code installed now: stop it,
 * then start it again in its folder, with its name and spawn mode. The
 * sessions it serves come back with it.
 */
async function restartRcServer(hostId: string, account: string, server: RcServer) {
  await remoteStopRcServer({ hostId, account, pid: server.pid })
  return remoteStartRcServer({
    hostId,
    account,
    request: {
      folder: server.folder,
      name: server.name ?? undefined,
      spawn: server.spawn === 'worktree' ? 'worktree' : 'same-dir',
      trustFolder: false,
    },
  })
}

/** Restart one Remote Control server (see `restartRcServer`), then read them again. */
export function useRestartRcServer(hostId: string, account: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (server: RcServer) => restartRcServer(hostId, account, server),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['remote', hostId, 'accounts', account] }),
  })
}

/**
 * Restart each of `servers` in turn, going on past one that fails; resolves
 * to the folders of those that did.
 */
export function useRestartAllRcServers(hostId: string, account: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (servers: Array<RcServer>) => {
      const failed: Array<string> = []
      for (const server of servers) {
        await restartRcServer(hostId, account, server).catch(() => failed.push(server.folder))
      }
      return failed
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['remote', hostId, 'accounts', account] }),
  })
}

export function usePairHost() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { code: string; label?: string }) => remotePairHost(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.remote.all }),
  })
}

/** Change a host's own settings, then read its info again to show them. */
export function useSetHostSettings(hostId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (remoteControlSuffix: string | null) => remoteSetHostSettings({ hostId, remoteControlSuffix }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.remote.info(hostId) }),
  })
}

export function useRenameHost() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { hostId: string; label: string }) => remoteRenameHost(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.remote.hosts }),
  })
}

export function useRemoveHost() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (hostId: string) => remoteRemoveHost(hostId),
    onSuccess: (_result, hostId) => {
      queryClient.removeQueries({ queryKey: ['remote', hostId] })
      return queryClient.invalidateQueries({ queryKey: queryKeys.remote.hosts })
    },
  })
}

/** A folder's subfolders on the host, for the new-session picker. */
export function useRemoteDirs(hostId: string, path: string | null, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.remote.dirs(hostId, path),
    queryFn: () => remoteListDirs({ hostId, path: path ?? undefined }),
    enabled,
    retry: 0,
    staleTime: 10_000,
  })
}

/**
 * Starting, resuming, restarting and stopping change what's running, so each
 * refreshes the account's sessions and the host's accounts (their running
 * counts) when done.
 */
function useLaunchMutation<Input, Output = Awaited<ReturnType<typeof remoteNewSession>>>(
  hostId: string,
  account: string,
  launch: (input: Input) => Promise<Output>,
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: launch,
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.remote.sessions(hostId, account) })
      await queryClient.invalidateQueries({ queryKey: queryKeys.remote.accounts(hostId) })
    },
  })
}

export function useNewRemoteSession(hostId: string, account: string) {
  return useLaunchMutation(hostId, account, (request: NewRemoteSession) =>
    remoteNewSession({ hostId, account, request }),
  )
}

export function useResumeRemoteSession(hostId: string, account: string) {
  return useLaunchMutation(hostId, account, (sessionId: string) =>
    remoteResumeSession({ hostId, account, sessionId, trustFolder: true }),
  )
}

/**
 * What moving a session to account `to` would do. Re-read when the window
 * regains focus: what's running on the host changes outside the app.
 */
export function useRemoteTransferPlan(hostId: string, account: string, sessionId: string, to: string | null) {
  return useQuery({
    queryKey: queryKeys.remote.transferPlan(hostId, account, sessionId, to ?? ''),
    queryFn: () => remoteTransferPlan({ hostId, account, sessionId, to: to ?? '' }),
    enabled: to !== null,
    refetchOnWindowFocus: 'always',
    retry: 0,
    gcTime: 0,
  })
}

/** A move changes both accounts' sessions, and their running counts. */
export function useRemoteTransfer(hostId: string, account: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ sessionId, request }: { sessionId: string; request: RemoteTransferRequest }) =>
      remoteTransferSession({ hostId, account, sessionId, request }),
    onSettled: async (_report, _error, { request }) => {
      for (const name of [account, request.to]) {
        await queryClient.invalidateQueries({ queryKey: queryKeys.remote.sessions(hostId, name) })
        await queryClient.invalidateQueries({ queryKey: queryKeys.remote.archived(hostId, name) })
      }
      await queryClient.invalidateQueries({ queryKey: queryKeys.remote.accounts(hostId) })
    },
  })
}

/** How far the move started as `progressId` has got, while it runs. */
export function useRemoteMoveProgress(hostId: string, progressId: string | null) {
  return useQuery({
    queryKey: queryKeys.remote.move(hostId, progressId),
    queryFn: () => remoteTransferProgress({ hostId, progressId: progressId ?? '' }),
    enabled: progressId !== null,
    refetchInterval: 500,
    retry: false,
    gcTime: 0,
  })
}

export function useRemoteMergeMemory(hostId: string, account: string) {
  return useMutation({
    mutationFn: (input: { sessionId: string; to: string; path: string }) =>
      remoteMergeMemory({ hostId, account, ...input }),
  })
}

export function useRemoteArchivedSessions(hostId: string, account: string) {
  return useQuery({
    queryKey: queryKeys.remote.archived(hostId, account),
    queryFn: () => remoteArchivedSessions({ hostId, account }),
    retry: 0,
  })
}

/** Archiving and restoring move a session between the two lists. */
function useArchiveMutation<Input, Output>(hostId: string, account: string, run: (input: Input) => Promise<Output>) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: run,
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.remote.sessions(hostId, account) })
      await queryClient.invalidateQueries({ queryKey: queryKeys.remote.archived(hostId, account) })
      await queryClient.invalidateQueries({ queryKey: queryKeys.remote.accounts(hostId) })
    },
  })
}

export function useArchiveRemoteSession(hostId: string, account: string) {
  return useArchiveMutation(hostId, account, (sessionId: string) =>
    remoteArchiveSession({ hostId, account, sessionId }),
  )
}

export function useRestoreRemoteSession(hostId: string, account: string) {
  return useArchiveMutation(hostId, account, (input: { sessionId: string; archive: string }) =>
    remoteRestoreSession({ hostId, account, ...input }),
  )
}

export function useDeleteRemoteArchive(hostId: string, account: string) {
  return useArchiveMutation(hostId, account, (input: { sessionId: string; archive: string }) =>
    remoteDeleteArchive({ hostId, account, ...input }),
  )
}

export function useRestartRemoteSession(hostId: string, account: string) {
  return useLaunchMutation(hostId, account, (sessionId: string) =>
    remoteRestartSession({ hostId, account, sessionId, trustFolder: true }),
  )
}

export function useStopRemoteSession(hostId: string, account: string) {
  return useLaunchMutation(hostId, account, (sessionId: string) => remoteStopSession({ hostId, account, sessionId }))
}

/** Deleting a profile changes the host's account list. */

export function useDeleteRemoteAccount(hostId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (account: string) => remoteDeleteAccount({ hostId, account }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.remote.accounts(hostId) }),
  })
}

/**
 * Signing a remote account in: start (the host prints a link, the browser
 * opens it), submit the code the page shows, or cancel.
 */
export function useRemoteSignIn(hostId: string, account: string) {
  const queryClient = useQueryClient()
  const start = useMutation({ mutationFn: () => remoteLoginStart({ hostId, account }) })
  const submit = useMutation({
    mutationFn: (input: { loginId: string; code: string }) => remoteLoginSubmit({ hostId, ...input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.remote.accounts(hostId) }),
  })
  const cancel = (loginId: string) => remoteLoginCancel({ hostId, loginId }).catch(() => undefined)
  return { start, submit, cancel }
}

/** One account on a paired host, as a profile of this app. */
export type RemoteProfile = {
  host: RemoteHost
  account: RemoteAccount
  /** `remote:<host>:<account>`, its sidebar id. */
  id: string
  /** `null` until it has been given one (see {@link useAdoptRemoteProfiles}). */
  color: string | null
}

/**
 * Every account on every paired host, as profiles, in sidebar order: host by
 * host, in the order each host lists its accounts. A host that hasn't
 * answered contributes none.
 */
/** A session on a host with Remote Control connected, and whose account it's on. */
export type RemoteControlSession = {
  host: RemoteHost
  account: string
  email: string | null
  session: RemoteSession
  /** The Remote Control server that started it, if one did and is listed. */
  server: RcServer | null
}

/**
 * The sessions with Remote Control connected, on every paired host, in the
 * profiles `keep` accepts (all of them without it). Nothing while not
 * `enabled`.
 */
export function useAllRemoteControlSessions(
  enabled = true,
  keep: (profile: RemoteProfile) => boolean = () => true,
): Array<RemoteControlSession> {
  const hosts = useQuery({ queryKey: queryKeys.remote.hosts, queryFn: remoteListHosts, enabled }).data ?? []
  const profiles = useRemoteProfiles(enabled ? hosts : []).filter(keep)
  const results = useQueries({
    queries: profiles.map((profile) => ({
      queryKey: queryKeys.remote.sessions(profile.host.id, profile.account.name),
      queryFn: () => remoteListSessions({ hostId: profile.host.id, account: profile.account.name }),
      retry: 0,
      refetchOnWindowFocus: 'always' as const,
      refetchInterval: 15_000,
    })),
  })
  const servers = useQueries({
    queries: profiles.map((profile) => ({
      queryKey: queryKeys.remote.rcServers(profile.host.id, profile.account.name),
      queryFn: () => remoteListRcServers({ hostId: profile.host.id, account: profile.account.name }),
      retry: 0,
      refetchInterval: 15_000,
    })),
  })
  return profiles.flatMap((profile, index) =>
    (results[index]?.data ?? [])
      .filter((session) => session.running && session.remoteControl && session.bridgeSessionId !== null)
      .map((session) => ({
        host: profile.host,
        account: profile.account.name,
        email: profile.account.account?.email ?? null,
        session,
        server: servingServer(session, servers[index]?.data ?? []) ?? null,
      })),
  )
}

/**
 * The connected sessions in the profiles signed in to `email`: what a desktop
 * app signed in to that account can open. Empty without an email.
 */
export function useRemoteControlSessions(email: string | null): Array<RemoteControlSession> {
  const wanted = email?.toLowerCase() ?? null
  return useAllRemoteControlSessions(
    email !== null,
    (profile) => wanted !== null && profile.account.account?.email?.toLowerCase() === wanted,
  )
}

export function useRemoteProfiles(hosts: Array<RemoteHost>): Array<RemoteProfile> {
  const results = useQueries({
    queries: hosts.map((host) => ({
      queryKey: queryKeys.remote.accounts(host.id),
      queryFn: () => remoteListAccounts(host.id),
      retry: 0,
      refetchOnWindowFocus: 'always' as const,
      refetchInterval: 60_000,
    })),
  })
  return hosts.flatMap((host, index) =>
    (results[index]?.data ?? []).map((account) => ({
      host,
      account,
      id: `remote:${host.id}:${account.name}`,
      color: host.profiles?.[account.name]?.color ?? null,
    })),
  )
}

/**
 * Give every remote account that has no color yet one, so each shows as a
 * profile of its own: the next preset color its host doesn't use yet. Runs
 * as accounts turn up, whether made here or on the host.
 */
export function useAdoptRemoteProfiles(profiles: Array<RemoteProfile>) {
  const queryClient = useQueryClient()
  const pending = useRef(new Set<string>())
  useEffect(() => {
    const uncolored = profiles.filter((profile) => profile.color === null && !pending.current.has(profile.id))
    if (uncolored.length === 0) {
      return
    }
    const used = new Map<string, Set<string>>()
    for (const profile of profiles) {
      const colors = used.get(profile.host.id) ?? new Set<string>()
      if (profile.color) {
        colors.add(profile.color)
      }
      used.set(profile.host.id, colors)
    }
    void (async () => {
      for (const profile of uncolored) {
        pending.current.add(profile.id)
        const taken = used.get(profile.host.id) ?? new Set<string>()
        const color =
          presetColors.find((preset) => !taken.has(preset)) ?? presetColors[taken.size % presetColors.length]
        taken.add(color)
        try {
          await remoteSetProfileColor({ hostId: profile.host.id, account: profile.account.name, color })
        } finally {
          pending.current.delete(profile.id)
        }
      }
      await queryClient.invalidateQueries({ queryKey: queryKeys.remote.hosts })
    })()
  }, [profiles, queryClient])
}

export function useSetRemoteProfileColor(hostId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ account, color }: { account: string; color: string }) =>
      remoteSetProfileColor({ hostId, account, color }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.remote.hosts }),
  })
}

/**
 * Renaming a profile changes its name everywhere the app keeps it: the host's
 * account list, its color (carried over by the backend), its sessions' key.
 */
export function useRenameRemoteProfile(hostId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { account: string; newName: string; stopRunning: boolean }) =>
      remoteRenameAccount({ hostId, ...input }),
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.remote.accounts(hostId) })
      await queryClient.invalidateQueries({ queryKey: queryKeys.remote.hosts })
    },
  })
}

/** A session's new name shows in its account's list. */
export function useRenameRemoteSession(hostId: string, account: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ sessionId, name }: { sessionId: string; name: string }) =>
      remoteRenameSession({ hostId, account, sessionId, name }),
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.remote.sessions(hostId, account) })
    },
  })
}

/**
 * The first half of switching a profile's account: sign it out, and have the
 * host resume its running sessions at the next sign-in, as whichever account.
 */
export function useSwitchAccountSignOut(hostId: string, account: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => remoteLogout({ hostId, account, stopRunning: true, resumeAfterSignIn: true }),
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.remote.accounts(hostId) })
      await queryClient.invalidateQueries({ queryKey: queryKeys.remote.sessions(hostId, account) })
    },
  })
}

/** Signing out stops the profile's sessions, and changes its status. */
export function useRemoteLogout(hostId: string, account: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (stopRunning: boolean) => remoteLogout({ hostId, account, stopRunning }),
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.remote.accounts(hostId) })
      await queryClient.invalidateQueries({ queryKey: queryKeys.remote.sessions(hostId, account) })
    },
  })
}
