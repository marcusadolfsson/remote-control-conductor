import type { HostInfo } from '@/lib/types'

/**
 * Pure: whether a host is another Mac sharing its Remote Control servers,
 * which offers only those (no sessions, moves or sign-ins). Its app says so
 * in its version.
 */
export function isMacHost(info: HostInfo | undefined): boolean {
  return info?.serverVersion.endsWith('(Mac)') ?? false
}
