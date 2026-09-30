/** The first server version with settings of its own (`PUT /v1/settings`). */
const SETTINGS_SINCE = [0, 6, 3]

/**
 * Pure: whether a server of `version` takes settings from the app. One that
 * can't be read is taken to be older.
 */
export function supportsHostSettings(version: string | undefined): boolean {
  const parts = version?.split('.').map(Number)
  if (!parts || parts.length < 3 || parts.some(Number.isNaN)) {
    return false
  }
  for (const [index, since] of SETTINGS_SINCE.entries()) {
    if (parts[index] !== since) {
      return parts[index] > since
    }
  }
  return true
}
