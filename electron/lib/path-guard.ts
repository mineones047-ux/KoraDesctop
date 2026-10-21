/**
 * Path guard for fs:* writes (security review 2026-09-25).
 *
 * Extracted from electron/ipc/filesystem.ts into a pure module (no electron
 * imports) so the vitest suite imports the SAME implementation. On top of the
 * original string-prefix checks it now resolves symlinks/junctions: a link
 * inside an allowed directory that points at (say) System32 used to pass the
 * check, because only the user-facing path was examined. The async check
 * resolves the deepest existing ancestor with realpath and validates BOTH the
 * literal and the resolved path.
 */
import fs from 'fs/promises'
import path from 'path'
import os from 'os'

// Sensitive system directories that should never be written to or deleted
export const BLOCKED_WRITE_PATHS: string[] = (() => {
  if (process.platform === 'win32') {
    const sysRoot = process.env.SystemRoot || 'C:\\Windows'
    const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming')
    const startup = path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup')
    return [
      path.win32.join(sysRoot, 'System32'),
      path.win32.join(sysRoot, 'SysWOW64'),
      path.win32.join(sysRoot, 'Boot'),
      'C:\\',
      'C:\\Program Files',
      'C:\\Program Files (x86)',
      'C:\\ProgramData',
      startup,
      path.join(os.homedir(), '.ssh'),
      path.join(os.homedir(), '.gnupg'),
    ]
  }
  return ['/etc', '/boot', '/sys', '/proc', '/dev', '/sbin', '/usr/sbin', '/usr/bin']
})()

// Maximum path length to prevent buffer overflow attacks
export const MAX_PATH_LENGTH = 4096

/**
 * Resolve a user-provided path to a normalized absolute path,
 * blocking traversal attacks (e.g. ../../etc/passwd) and
 * writes to critical system directories.
 */
export function resolveSafePath(inputPath: string): string {
  const expanded = inputPath
    .trim()
    .replace(/^["']|["']$/g, '')
    .replace(/["']/g, '')
    .trim()
    .replace(/^~/, os.homedir())
  const resolved = path.resolve(expanded)

  if (resolved.length > MAX_PATH_LENGTH) {
    throw new Error(`Path too long (${resolved.length} chars, max ${MAX_PATH_LENGTH})`)
  }
  return resolved
}

export function assertNotBlockedWrite(resolvedPath: string): void {
  const normalized = resolvedPath.toLowerCase().replace(/\\/g, '/')
  for (const blocked of BLOCKED_WRITE_PATHS) {
    const blockedNormalized = blocked.toLowerCase().replace(/\\/g, '/')
    if (normalized === blockedNormalized || normalized.startsWith(blockedNormalized + '/')) {
      throw new Error(
        `Access to system directory blocked: ${resolvedPath}. ` +
          `This path is in a critical system area that cannot be modified.`,
      )
    }
  }
}

/**
 * realpath of the deepest EXISTING ancestor + the remaining (not yet
 * created) suffix. Non-existing paths resolve ancestor by ancestor so the
 * check works for a file that is about to be created.
 */
export async function realpathDeepest(target: string): Promise<string> {
  const tail: string[] = []
  let cur = target
  for (;;) {
    try {
      const real = await fs.realpath(cur)
      return tail.length ? path.join(real, ...tail.reverse()) : real
    } catch {
      const parent = path.dirname(cur)
      if (parent === cur) return target
      tail.push(path.basename(cur))
      cur = parent
    }
  }
}

/**
 * The full write-target check: the literal path AND its symlink-resolved
 * form must both be outside the blocklist.
 */
export async function assertSafeWriteTarget(resolvedPath: string): Promise<void> {
  assertNotBlockedWrite(resolvedPath)
  const real = await realpathDeepest(resolvedPath)
  if (real.toLowerCase() !== resolvedPath.toLowerCase()) {
    assertNotBlockedWrite(real)
  }
}