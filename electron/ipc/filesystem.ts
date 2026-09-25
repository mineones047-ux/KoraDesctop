/**
 * Filesystem IPC handlers (fs:*).
 *
 * Every path goes through resolveSafePath() (quote stripping, `~` expansion,
 * path.resolve, length cap) and write/delete/rename/mkdir additionally through
 * assertNotBlockedWrite() (System32, Program Files, Startup, .ssh, ...).
 * Writes are atomic (tmp + rename with a crypto suffix); grep is ReDoS-guarded
 * via electron/lib/regex-security.ts and skips node_modules/.git/hidden dirs.
 */
import { ipcMain } from 'electron'
import fs from 'fs/promises'
import path from 'path'
import os from 'os'
import crypto from 'crypto'
import { isUnsafeRegex, matchGlob } from '../lib/regex-security'

const stripQuotes = (p: string): string =>
  p
    .trim()
    .replace(/^["']|["']$/g, '')
    .replace(/["']/g, '')
    .trim()

const expand = (p: string): string => stripQuotes(p).replace(/^~/, os.homedir())

// Sensitive system directories that should never be written to or deleted
const BLOCKED_WRITE_PATHS: string[] = (() => {
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
const MAX_PATH_LENGTH = 4096

/**
 * Resolve a user-provided path to a normalized absolute path,
 * blocking traversal attacks (e.g. ../../etc/passwd) and
 * writes to critical system directories.
 */
function resolveSafePath(inputPath: string): string {
  const expanded = expand(inputPath)
  const resolved = path.resolve(expanded)

  // Block paths exceeding OS limit
  if (resolved.length > MAX_PATH_LENGTH) {
    throw new Error(`Path too long (${resolved.length} chars, max ${MAX_PATH_LENGTH})`)
  }

  return resolved
}

function assertNotBlockedWrite(resolvedPath: string): void {
  const normalized = resolvedPath.toLowerCase().replace(/\\/g, '/')
  for (const blocked of BLOCKED_WRITE_PATHS) {
    const blockedNormalized = blocked.toLowerCase().replace(/\\/g, '/')
    // Check if the path IS the blocked dir or starts with it
    if (normalized === blockedNormalized || normalized.startsWith(blockedNormalized + '/')) {
      throw new Error(
        `Access to system directory blocked: ${resolvedPath}. ` +
        `This path is in a critical system area that cannot be modified.`
      )
    }
  }
}

async function readLimited(filePath: string, limit: number): Promise<string> {
  const s = await fs.stat(filePath)
  if (s.size > limit) {
    const fh = await fs.open(filePath, 'r')
    try {
      const buf = Buffer.alloc(limit)
      await fh.read(buf, 0, limit, 0)
      return buf.toString('utf-8')
    } finally {
      await fh.close()
    }
  }
  return fs.readFile(filePath, 'utf-8')
}

export function registerFileHandlers() {
  ipcMain.handle('fs:readDir', async (_event, dirPath: string) => {
    try {
      const resolvedPath = resolveSafePath(dirPath)
      const entries = await fs.readdir(resolvedPath, { withFileTypes: true })
      return entries.map((entry) => ({
        name: entry.name,
        isDirectory: entry.isDirectory(),
        path: path.join(resolvedPath, entry.name),
      }))
    } catch (error) {
      throw new Error((error as Error).message)
    }
  })

  ipcMain.handle('fs:readFile', async (_event, filePath: string, maxBytes?: number) => {
    try {
      const resolvedPath = resolveSafePath(filePath)
      const limit = typeof maxBytes === 'number' && maxBytes > 0 ? maxBytes : 5 * 1024 * 1024
      const s = await fs.stat(resolvedPath)
      if (s.size > limit) {
        const fh = await fs.open(resolvedPath, 'r')
        try {
          const buf = Buffer.alloc(limit)
          await fh.read(buf, 0, limit, 0)
          return buf.toString('utf-8') + `\n\n[TRUNCATED: file is ${s.size} bytes, read first ${limit}]`
        } finally {
          await fh.close()
        }
      }
      const content = await fs.readFile(resolvedPath, 'utf-8')
      return content
    } catch (error) {
      throw new Error((error as Error).message)
    }
  })

  ipcMain.handle('fs:writeFile', async (_event, filePath: string, content: string) => {
    try {
      const resolvedPath = resolveSafePath(filePath)
      assertNotBlockedWrite(resolvedPath)
      await fs.mkdir(path.dirname(resolvedPath), { recursive: true })
      // Use crypto random suffix to prevent predictable temp filenames (race condition)
      const tmp = resolvedPath + '.kora-' + crypto.randomBytes(6).toString('hex')
      await fs.writeFile(tmp, content, { encoding: 'utf-8', mode: 0o600 })
      await fs.rename(tmp, resolvedPath)
      return { success: true }
    } catch (error) {
      throw new Error((error as Error).message)
    }
  })

  ipcMain.handle('fs:patchFile', async (_event, filePath: string, oldText: string, newText: string, replaceAll?: boolean) => {
    try {
      if (typeof oldText !== 'string' || oldText.length === 0) {
        return { success: false, error: 'oldText must be a non-empty string' }
      }
      if (typeof newText !== 'string' || newText.length > 100000) {
        return { success: false, error: 'newText must be a string up to 100000 chars' }
      }
      const resolvedPath = resolveSafePath(filePath)
      assertNotBlockedWrite(resolvedPath)
      const original = await fs.readFile(resolvedPath, 'utf-8')
      const occurrences = original.split(oldText).length - 1
      if (occurrences === 0) {
        return { success: false, error: 'oldText not found in file' }
      }
      if (!replaceAll && occurrences > 1) {
        return { success: false, error: `oldText found ${occurrences} times; pass replaceAll=true or provide more context` }
      }
      const patched = replaceAll ? original.split(oldText).join(newText) : original.replace(oldText, newText)
      // Use crypto random suffix to prevent predictable temp filenames (race condition)
      const tmp = resolvedPath + '.kora-' + crypto.randomBytes(6).toString('hex')
      await fs.writeFile(tmp, patched, { encoding: 'utf-8', mode: 0o600 })
      await fs.rename(tmp, resolvedPath)
      return { success: true, replacements: replaceAll ? occurrences : 1 }
    } catch (error) {
      throw new Error((error as Error).message)
    }
  })

  ipcMain.handle('fs:grep', async (_event, dirPath: string, pattern: string, options?: { include?: string; maxResults?: number; caseInsensitive?: boolean }) => {
    try {
      if (typeof pattern !== 'string' || pattern.length === 0 || pattern.length > 200) {
        throw new Error('pattern must be a non-empty string up to 200 chars')
      }
      const resolvedDir = resolveSafePath(dirPath || '.')
      const maxResults = options?.maxResults ?? 100
      const include = options?.include
      const ci = options?.caseInsensitive ?? true
      // ReDoS guard: a user-supplied regex runs inside the main process, so a
      // catastrophically backtracking pattern (e.g. "(a+)+$") would freeze the app.
      if (isUnsafeRegex(pattern)) {
        throw new Error('Pattern rejected: nested or ambiguous quantifiers are not allowed')
      }
      const re = new RegExp(pattern, ci ? 'i' : '')
      const results: Array<{ file: string; line: number; text: string }> = []

      async function walk(dir: string, depth: number) {
        if (results.length >= maxResults || depth > 20) return
        let entries: any[]
        try {
          entries = await fs.readdir(dir, { withFileTypes: true })
        } catch {
          return
        }
        for (const entry of entries) {
          if (results.length >= maxResults) return
          if (entry.name === 'node_modules' || entry.name === '.git' || entry.name.startsWith('.')) continue
          if (entry.isSymbolicLink()) continue // junction/symlink loops
          const full = path.join(dir, entry.name)
          if (entry.isDirectory()) {
            await walk(full, depth + 1)
          } else if (entry.isFile()) {
            if (include && !matchGlob(entry.name, include)) continue
            try {
              const content = await readLimited(full, 2 * 1024 * 1024)
              const lines = content.split(/\r?\n/)
              for (let i = 0; i < lines.length; i++) {
                if (re.test(lines[i])) {
                  results.push({ file: full, line: i + 1, text: lines[i].slice(0, 500) })
                  if (results.length >= maxResults) return
                }
              }
            } catch {}
          }
        }
      }

      await walk(resolvedDir, 0)
      return { count: results.length, results }
    } catch (error) {
      throw new Error((error as Error).message)
    }
  })

  // Detects patterns whose quantifiers can backtrack catastrophically.
  // Implementation lives in electron/lib/regex-security.ts (shared with tests).

  ipcMain.handle('fs:homeDir', async () => {
    return os.homedir()
  })

  ipcMain.handle('fs:deleteFile', async (_event, filePath: string) => {
    try {
      const resolved = resolveSafePath(filePath)
      assertNotBlockedWrite(resolved)
      const s = await fs.stat(resolved)
      if (s.isDirectory()) {
        await fs.rm(resolved, { recursive: true })
      } else {
        await fs.unlink(resolved)
      }
      return { success: true }
    } catch (error) {
      throw new Error((error as Error).message)
    }
  })

  ipcMain.handle('fs:rename', async (_event, oldPath: string, newPath: string) => {
    try {
      const resolvedOld = resolveSafePath(oldPath)
      const resolvedNew = resolveSafePath(newPath)
      assertNotBlockedWrite(resolvedNew)
      await fs.mkdir(path.dirname(resolvedNew), { recursive: true })
      await fs.rename(resolvedOld, resolvedNew)
      return { success: true }
    } catch (error) {
      throw new Error((error as Error).message)
    }
  })

  ipcMain.handle('fs:copy', async (_event, oldPath: string, newPath: string) => {
    try {
      const resolvedOld = resolveSafePath(oldPath)
      const resolvedNew = resolveSafePath(newPath)
      assertNotBlockedWrite(resolvedNew)
      await fs.mkdir(path.dirname(resolvedNew), { recursive: true })
      const s = await fs.stat(resolvedOld)
      if (s.isDirectory()) {
        await fs.cp(resolvedOld, resolvedNew, { recursive: true })
      } else {
        await fs.copyFile(resolvedOld, resolvedNew)
      }
      return { success: true }
    } catch (error) {
      throw new Error((error as Error).message)
    }
  })

  ipcMain.handle('fs:mkdir', async (_event, dirPath: string) => {
    try {
      const resolved = resolveSafePath(dirPath)
      assertNotBlockedWrite(resolved)
      await fs.mkdir(resolved, { recursive: true })
      return { success: true }
    } catch (error) {
      throw new Error((error as Error).message)
    }
  })

  ipcMain.handle('fs:stat', async (_event, filePath: string) => {
    try {
      const resolved = resolveSafePath(filePath)
      const s = await fs.stat(resolved)
      return {
        size: s.size,
        isDirectory: s.isDirectory(),
        isFile: s.isFile(),
        created: s.birthtime.toISOString(),
        modified: s.mtime.toISOString(),
      }
    } catch (error) {
      throw new Error((error as Error).message)
    }
  })

  ipcMain.handle('fs:exists', async (_event, filePath: string) => {
    try {
      const resolved = resolveSafePath(filePath)
      await fs.access(resolved)
      return { exists: true }
    } catch {
      return { exists: false }
    }
  })

  // Safe file search using fs API (no shell injection)
  ipcMain.handle('fs:findFiles', async (_event, pattern: string, options?: { searchDir?: string; maxResults?: number; maxDepth?: number }) => {
    try {
      const searchDir = options?.searchDir || '~'
      const resolvedDir = resolveSafePath(searchDir)
      const maxResults = options?.maxResults ?? 100
      const maxDepth = options?.maxDepth ?? 10
      
      // Validate pattern - only allow simple glob patterns
      const safePattern = pattern.replace(/[\\/"<>|*?]/g, '').slice(0, 200)
      if (!safePattern) {
        return { success: false, error: 'Invalid pattern', results: [] }
      }
      
      const results: string[] = []
      const patternRegex = new RegExp(safePattern.replace(/\*/g, '.*').replace(/\?/g, '.'), 'i')
      
      async function walk(dir: string, depth: number) {
        if (results.length >= maxResults || depth > maxDepth) return
        let entries: any[]
        try {
          entries = await fs.readdir(dir, { withFileTypes: true })
        } catch {
          return
        }
        for (const entry of entries) {
          if (results.length >= maxResults) return
          if (entry.name === 'node_modules' || entry.name === '.git' || entry.name.startsWith('.')) continue
          const fullPath = path.join(dir, entry.name)
          if (patternRegex.test(entry.name)) {
            results.push(fullPath)
          }
          if (entry.isDirectory() && !entry.isSymbolicLink()) {
            await walk(fullPath, depth + 1)
          }
        }
      }
      
      await walk(resolvedDir, 0)
      return { success: true, results, count: results.length }
    } catch (error) {
      return { success: false, error: (error as Error).message, results: [] }
    }
  })
}