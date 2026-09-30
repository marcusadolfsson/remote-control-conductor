/**
 * Pure: `count` sessions, as a sentence says it.
 */
export function sessionCount(count: number): string {
  return `${count} ${count === 1 ? 'session' : 'sessions'}`
}

/**
 * Pure: what switching a profile's account does to its `running` sessions,
 * as the confirmation says it.
 */
export function switchEffect(running: number): string {
  const sessions =
    running === 0
      ? ''
      : `Its ${sessionCount(running)} ${running === 1 ? 'stops' : 'stop'}, and ${running === 1 ? 'resumes' : 'resume'} under the new account as soon as it's signed in: the same conversations, with Remote Control on. `
  return `${sessions}Nothing moves, and no other profile is touched.`
}

/**
 * Pure: whether signing in again landed on the account it was on before,
 * as when the browser was still signed in to claude.ai as that one.
 */
export function sameAccount(previous: string | null, now: string | null): boolean {
  return previous !== null && now !== null && previous.toLowerCase() === now.toLowerCase()
}
