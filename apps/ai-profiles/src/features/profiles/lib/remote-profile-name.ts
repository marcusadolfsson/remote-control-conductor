/**
 * A name the server takes for a new account folder: letters, digits, `-` and
 * `_`, starting with a letter or digit, at most 64, and not `default`. Mirrors
 * `valid_new_name` in the server.
 */
export function isValidRemoteProfileName(name: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(name) && name !== 'default'
}

const invalidHint = 'Letters, digits, - and _, starting with a letter or digit. "default" is taken.'

/** What the line under a remote profile's name says, and whether it's a problem. */
type NameHint = {
  /** The line. */
  text: string
  /** The name can't be used, so it reads as an error. */
  problem: boolean
}

/**
 * Pure: the line under a new remote profile's name: where on the server it
 * goes, or why it can't. Blank (but holding its height) until one is typed.
 */
export function newRemoteNameHint(name: string, hostLabel: string | undefined, taken?: boolean): NameHint {
  const trimmed = name.trim()
  if (trimmed === '') {
    return { text: '\u00A0', problem: false }
  }
  if (!isValidRemoteProfileName(trimmed)) {
    return { text: invalidHint, problem: true }
  }
  if (taken) {
    return { text: `${hostLabel ?? 'The server'} already has a profile called ${trimmed}.`, problem: true }
  }
  return { text: `On ${hostLabel ?? 'the server'}: ~/.claude-accounts/${trimmed}`, problem: false }
}

/** Renaming a remote profile, as the edit dialog reads it. */
type RemoteRename = {
  /** The new name, trimmed. */
  trimmed: string
  /** It differs from the current name. */
  renaming: boolean
  /** Nothing stops it: the name is free and one the server takes. */
  ok: boolean
  /** The line under the name. */
  hint: NameHint
}

/**
 * Pure: whether a remote profile can take a new name, and the line under it.
 * The name is its account folder on the server, so it must be one the server
 * takes and no other profile there has (ignoring case). The default profile
 * is `~/.claude`, and keeps its name.
 */
export function remoteRename({
  name,
  newName,
  taken,
  fixed,
  hostLabel,
}: {
  /** Its name now. */
  name: string
  /** The name typed. */
  newName: string
  /** Every profile name on the host, this one included. */
  taken: Array<string>
  /** It's the host's default profile. */
  fixed: boolean
  /** The host's name. */
  hostLabel: string
}): RemoteRename {
  const trimmed = newName.trim()
  const renaming = trimmed !== name
  const clash = renaming && taken.some((other) => other !== name && other.toLowerCase() === trimmed.toLowerCase())
  const invalid = renaming && !isValidRemoteProfileName(trimmed)
  const problem = clash || invalid
  let text = `On ${hostLabel}: ~/.claude-accounts/${trimmed || name}`
  if (fixed) {
    text = 'The default profile is ~/.claude, and keeps its name.'
  } else if (clash) {
    text = `${hostLabel} already has a profile called ${trimmed}.`
  } else if (invalid) {
    text = invalidHint
  }
  return { trimmed, renaming, ok: !problem, hint: { text, problem } }
}
