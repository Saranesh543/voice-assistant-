/**
 * Cross-platform path handling for JARVIS.
 *
 * Windows drive paths (C:\... or C:/...) and POSIX root paths (/Users/...)
 * must both be recognized as local disk locations, and file:/// URLs
 * must strip the scheme without corrupting Windows drive letters or POSIX slashes.
 */

/**
 * Matches absolute disk paths on Windows (C:\... or C:/...) and POSIX systems.
 */
export const DISK_PATH =
  /^(?:[a-zA-Z]:[\\/]|\/(?:Users|home|root|Volumes|Applications|System|Library|private|tmp|var|opt|mnt|media|srv|data)\/)/

/**
 * Strips the `file:///` protocol from a path.
 * - On Windows: `file:///C:/Users/...` becomes `C:/Users/...` (extra leading slash stripped)
 * - On POSIX: `file:///Users/...` becomes `/Users/...` (leading slash preserved)
 */
export function stripFileProtocol(raw: string): string {
  if (!raw.startsWith('file://')) return raw
  if (raw.startsWith('file:///')) {
    const remainder = raw.slice(8)
    if (/^[a-zA-Z]:/.test(remainder)) {
      return remainder
    }
    // On POSIX, 'file:///Users/...' -> raw.slice(7) is '/Users/...'
    return raw.slice(7)
  }
  // file://C:/... or file://Users/...
  const remainder = raw.slice(7)
  if (/^[a-zA-Z]:/.test(remainder)) return remainder
  return '/' + remainder
}

/**
 * Returns true if the string represents an absolute local disk path
 * (either directly or via a file:// URI).
 */
export function isDiskPath(raw: string): boolean {
  const path = stripFileProtocol(raw)
  return DISK_PATH.test(path)
}
