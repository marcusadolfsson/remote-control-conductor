/** One session on a host profile, as the pane shows it. */
export type ConductorSession = {
  id: string
  title: string
  cwd: string | null
  running: boolean
  waiting: boolean
  remoteControl: boolean
  updatePending: boolean
  /** The session's id on claude.ai (`session_…`), while Remote Control is on. */
  bridgeSessionId: string | null
}

/** One Claude account on a host, with its sessions. */
export type ConductorAccount = {
  name: string
  email: string | null
  signedIn: boolean
  sessions: Array<ConductorSession>
}

/** One paired host, or why it couldn't be read. */
export type ConductorHost = {
  id: string
  label: string
  address: string | null
  serverVersion: string | null
  claudeVersion: string | null
  accounts: Array<ConductorAccount>
  error: string | null
}

/** What the pane draws. */
export type ConductorView = {
  isLoading: boolean
  hosts: Array<ConductorHost>
  updatedAt: number | null
  error: string | null
}

/** What the last action said, under the buttons. */
export type ConductorNote = { text: string; isError: boolean }

declare module 'claude-code' {
  interface PluginState {
    conductor: {
      view: ConductorView
      /** The selected session, `<host id>/<account>/<session id>`. */
      selected: string | null
      /** The action waiting for a second press, `<selected>:<action>`. */
      confirming: string | null
      /** The action running now, `<selected>:<action>`. */
      busy: string | null
      note: ConductorNote | null
    }
  }
}
