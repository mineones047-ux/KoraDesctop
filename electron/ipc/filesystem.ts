/**
 * Filesystem IPC handlers (fs:*).
 *
 * Every path goes through resolveSafePath() (quote stripping, `~` expansion,
 * path.resolve, length cap) and every mutation additionally through
 * assertSafeWriteTarget() — the blocklist check on the literal path *and* on its
 * symlink-resolved form (System32, Program Files, Startup, .ssh, ...).
 * Both live in electron/lib/path-guard.ts, the same module the RPC core
 * (`core/methods.ts`) and the vitest suite import: one implementation, no copy
 * that can drift away from the hardened one.
 * Writes are atomic (tmp + rename with a crypto suffix); grep is ReDoS-guarded
 * via electron/lib/regex-security.ts and skips node_modules/.git/hidden dirs.
 */
import { ipcMain } from 'electron'
import fs from 'fs/promises'
import path from 'path'
import os from 'os'
import crypto from 'crypto'
import { isUnsafeRegex, matchGlob } from '../lib/regex-security'
import { assertSafeWriteTarget, resolveSafePath } from '../lib/path-guard'

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
      await assertSafeWriteTarget(resolvedPath)
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
      await assertSafeWriteTarget(resolvedPath)
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
      await assertSafeWriteTarget(resolved)
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
      // Moving modifies the SOURCE location too — both sides are checked, exactly
      // like the RPC core (`core/methods.ts`). Otherwise a rename could pull a file
      // out of System32 instead of writing into it.
      await assertSafeWriteTarget(resolvedOld)
      await assertSafeWriteTarget(resolvedNew)
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
      await assertSafeWriteTarget(resolvedNew)
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
      await assertSafeWriteTarget(resolved)
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
      
      const escapeRegexMeta = (s: string): string => s.replace(/[.*+?^${}()|[\]\\\\]/g, '\\$&')
      const patternRegex = new RegExp(escapeRegexMeta(safePattern), 'i')
      const results: string[] = []
      
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