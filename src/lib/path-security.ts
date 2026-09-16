const DANGEROUS_ROOTS = [
  '/',
  'C:\\',
  'C:',
  'D:\\',
  'D:',
  'E:\\',
  'E:',
  'F:\\',
  'F:',
]

const DANGEROUS_PATHS = [
  '/etc',
  '/bin',
  '/sbin',
  '/usr',
  '/boot',
  '/dev',
  '/proc',
  '/sys',
  '/var/log',
  '/windows',
  '/winnt',
  'C:\\Windows',
  'C:\\Program Files',
  'C:\\Program Files (x86)',
  'C:\\ProgramData',
  'C:\\System Volume Information',
]

function normalizePath(p: string): string {
  // Normalize separators and resolve relative components
  // Preserve the leading slash/backslash for absolute paths
  const isAbsolute = /^[\\/]/.test(p.trim())
  const normalized = p.replace(/\//g, '\\')
  // Resolve .. without accessing filesystem
  const parts = normalized.split('\\').filter(Boolean)
  const resolved: string[] = []
  for (const part of parts) {
    if (part === '..') {
      resolved.pop()
    } else if (part !== '.') {
      resolved.push(part)
    }
  }
  return (isAbsolute ? '\\' : '') + resolved.join('\\')
}

function isDangerousPath(normalized: string): string | null {
  const lower = normalized.toLowerCase()

  // Block root-level operations (normalize the root too for comparison)
  for (const root of DANGEROUS_ROOTS) {
    const normalizedRoot = root.toLowerCase().replace(/\//g, '\\')
    if (lower === normalizedRoot || lower === normalizedRoot + '\\') {
      return `Path resolves to root: ${root}`
    }
  }

  // Block sensitive system directories
  for (const dangerous of DANGEROUS_PATHS) {
    const d = dangerous.toLowerCase().replace(/\//g, '\\')
    if (lower === d || lower.startsWith(d + '\\')) {
      return `Path accesses restricted directory: ${dangerous}`
    }
  }

  return null
}

/**
 * Validate a path for security. Returns null if safe, or an error message if dangerous.
 * Use before file operations (write, delete, rename, mkdir) to prevent:
 * - Path traversal attacks (../../etc/passwd)
 * - Accidental deletion of system files
 * - Writing to sensitive directories
 */
export function validatePath(filePath: string): string | null {
  if (!filePath || filePath.trim().length === 0) {
    return 'Path is empty'
  }

  // Block null bytes
  if (filePath.includes('\0')) {
    return 'Path contains null bytes'
  }

  const normalized = normalizePath(filePath)

  // Must not be empty after normalization
  if (!normalized) {
    return 'Path resolves to empty'
  }

  // Check for dangerous paths
  const danger = isDangerousPath(normalized)
  if (danger) return danger

  return null
}

/**
 * Validate that a path is within allowed directories.
 * Use for read operations to prevent reading sensitive files.
 */
export function validatePathRead(filePath: string, allowedDirs?: string[]): string | null {
  if (!filePath || filePath.trim().length === 0) {
    return 'Path is empty'
  }

  if (filePath.includes('\0')) {
    return 'Path contains null bytes'
  }

  if (!allowedDirs) return null

  const normalized = normalizePath(filePath)
  const lower = normalized.toLowerCase()

  for (const dir of allowedDirs) {
    const allowed = normalizePath(dir).toLowerCase()
    if (lower === allowed || lower.startsWith(allowed + '\\')) {
      return null
    }
  }

  return `Path is outside allowed directories`
}
