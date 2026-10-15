/** Pure: what Restart all says for a profile's servers, `outdated` of them on an older Claude Code. */
export function restartAllServersLabel(outdated: number): string {
  return outdated > 0 ? `Restart all · ${outdated} to update` : 'Restart all'
}

/** Pure: what Restart all says on hover. */
export function restartAllServersTitle(count: number, outdated: number): string {
  const all = `Stop each of the ${count} Remote Control servers and start it again on the Claude Code installed now`
  return outdated > 0 ? `${all}: ${outdated} of them run an older one` : all
}
