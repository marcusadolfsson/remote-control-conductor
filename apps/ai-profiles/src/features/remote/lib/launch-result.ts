/**
 * Pure: the title of what a launch came to: whether the session's window is
 * still waiting on an answer, and whether it was running before.
 */
export function launchTitle(waiting: boolean, alreadyRunning: boolean): string {
  if (waiting) {
    return alreadyRunning ? 'Waiting for you' : 'Started, and waiting'
  }
  return alreadyRunning ? 'Already running' : 'Session started'
}
