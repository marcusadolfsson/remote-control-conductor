import type { RemoteAccount } from '@/lib/types'

/** One thing a remote profile's subline says after its host's name. */
type SublinePart = {
  /** Which part it is, unique in a subline. */
  id: 'offline' | 'signedOut' | 'identity' | 'plan' | 'left'
  /** What it says. */
  text: string
  /** Its color, when it isn't the subline's own. */
  tone?: 'danger' | 'warning' | 'quiet'
  /** What hovering it says. */
  title?: string
}

const hour = 3_600_000
const day = 24 * hour

/** How long a sign-in has left, in words: "27 days left", "5 hours left". */
export function signInLeft(until: string | null, now: number = Date.now()): string | null {
  if (until === null) {
    return null
  }
  const left = new Date(until).getTime() - now
  if (Number.isNaN(left)) {
    return null
  }
  if (left <= 0) {
    return 'expired'
  }
  if (left >= 2 * day) {
    return `${Math.floor(left / day)} days left`
  }
  if (left >= day) {
    return '1 day left'
  }
  if (left >= 2 * hour) {
    return `${Math.floor(left / hour)} hours left`
  }
  return 'less than 2 hours left'
}

/** How long the sign-in lasts, with when it ends on hover; nothing when that isn't known. */
function leftPart(until: string | null): SublinePart | null {
  const left = signInLeft(until)
  if (left === null) {
    return null
  }
  const ends = until ? new Date(until).toLocaleString() : null
  return { id: 'left', text: left, tone: 'quiet', title: ends ? `Signed in until ${ends}` : undefined }
}

/** A signed-in profile's parts: whose account it is, its plan, and how long the sign-in lasts. */
function signedInParts(account: RemoteAccount): Array<SublinePart> {
  const who = account.account
  const identity = who?.email ?? who?.name ?? null
  const parts: Array<SublinePart | null> = [
    identity ? { id: 'identity', text: identity, title: account.configDir } : null,
    who?.plan ? { id: 'plan', text: who.plan } : null,
    leftPart(account.signedInUntil),
  ]
  return parts.filter((part) => part !== null)
}

/**
 * Pure: what a remote profile's subline says after its host's name. That
 * the host is offline or the profile signed out says it all; otherwise,
 * whose account it is and for how long. Nothing while the profile is unknown.
 */
export function sublineParts(account: RemoteAccount | undefined, offline: boolean): Array<SublinePart> {
  if (offline) {
    return [{ id: 'offline', text: 'offline', tone: 'danger' }]
  }
  if (!account) {
    return []
  }
  if (!account.signedIn) {
    return [{ id: 'signedOut', text: 'Signed out', tone: 'warning' }]
  }
  return signedInParts(account)
}
