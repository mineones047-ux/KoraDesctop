/**
 * What system:openApp refuses to launch (security review 2026-09-25).
 * Pure module (no electron imports) so vitest imports the SAME code.
 *
 * Two rules:
 * 1. system utilities (cmd, PowerShell, regedit, …) never open via openPath;
 * 2. script/installer extensions that Windows would EXECUTE on "open"
 *    (.bat/.js/.ps1/… run through the shell association) are refused — the
 *    confirmed `!shell` path exists for users who really mean it.
 */
export const BLOCKED_OPEN_PATHS = [
  'c:\\windows\\system32\\cmd.exe',
  'c:\\windows\\system32\\windowspowershell',
  'c:\\windows\\system32\\regedit.exe',
  'c:\\windows\\system32\\msconfig.exe',
  'c:\\windows\\system32\\taskmgr.exe',
  '/bin/sh',
  '/bin/bash',
  '/usr/bin/sudo',
]

export function isBlockedOpenPath(p: string): boolean {
  const lower = p.toLowerCase().replace(/\//g, '\\').replace(/\\+$/, '')
  for (const blocked of BLOCKED_OPEN_PATHS) {
    if (lower === blocked || lower.startsWith(blocked + '\\')) return true
  }
  return false
}

/** Extensions Windows executes (rather than opens in an editor) on ShellExecute "open". */
export const BLOCKED_OPEN_EXTENSIONS = [
  '.bat',
  '.cmd',
  '.ps1',
  '.vbs',
  '.vbe',
  '.js',
  '.jse',
  '.wsf',
  '.wsh',
  '.hta',
  '.msi',
  '.scr',
  '.jar',
]

/**
 * Returns an error message when the target must not be opened, null when it
 * is allowed. Checks both the path blocklist and the extension list (query
 * strings / arguments are not expected here — openPath takes one path).
 */
export function checkOpenTarget(target: string): string | null {
  if (typeof target !== 'string' || target.length === 0 || target.length > 4096) {
    return 'Invalid path'
  }
  if (isBlockedOpenPath(target)) {
    return 'Access to system utilities is blocked'
  }
  const bare = target.trim().replace(/^["']|["']$/g, '').split(/[?#]/)[0]
  const ext = bare.slice(bare.lastIndexOf('.')).toLowerCase()
  if (ext && BLOCKED_OPEN_EXTENSIONS.includes(ext)) {
    return `Opening script/installer files is blocked (${ext}). Use !shell with explicit confirmation to run it.`
  }
  return null
}