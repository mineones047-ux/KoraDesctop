/**
 * kora-rpc/1 method table for the fs / shell / chats domains
 * (docs/CORE_RPC.md §5 — names, argument order and return shapes mirror the
 * existing IPC handlers exactly).
 *
 * The security rule that must survive every port
 * (docs/ROADMAP.md §6.1): **each command re-validates its input inside the
 * core** — a UI confirmation is never a security boundary. So every fs method
 * goes through `electron/lib/path-guard.ts` and shell through
 * `electron/lib/shell-security.ts`, exactly like the Electron IPC handlers
 * do. `shell.execute` therefore IGNORES a `bypassDangerCheck` param coming
 * from the wire: the caller on the other side of the boundary is untrusted.
 *
 * Pure-ish module: only node:fs/path/os, no Electron — vitest exercises this
 * same table against real tmp directories.
 */
import fs from 'fs/promises'
import path from 'path'
import os from 'os'
import crypto from 'crypto'
import { exec } from 'child_process'
import { promisify } from 'util'
import { isDangerousCommand } from '../electron/lib/shell-security'
import { resolveSafePath, assertSafeWriteTarget } from '../electron/lib/path-guard'
import { isUnsafeRegex, matchGlob, buildFindFilesPattern } from '../electron/lib/regex-security'
import type { MethodTable, MethodSpec } from './dispatch'

const execAsync = promisify(exec)

/**
 * A method was called with arguments the core cannot interpret.
 *
 * Distinct from a domain failure on purpose: this means the *call* was malformed, not that
 * the operation failed, and the dispatcher maps it to a protocol error rather than a result.
 */
class MethodError extends Error {}

/** Require a string argument, with a message that names the offending parameter. */
function str(v: unknown, name: string): string {
  if (typeof v !== 'string') throw new MethodError(`${name} must be a string`)
  return v
}

/**
 * Normalise `params` to a positional array.
 *
 * `count` pads a missing array with `undefined` rather than throwing, so a method can
 * check each argument itself and produce a message about *that* argument.
 */
function positional(params: unknown[] | Record<string, unknown> | undefined, count: number): unknown[] {
  if (params === undefined) return new Array(count).fill(undefined)
  if (Array.isArray(params)) return params
  throw new MethodError('params must be a positional array')
}

// ── fs ──

/** Read at most `limit` bytes, so a huge file cannot exhaust the core's memory. */
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

/** `fs.readFile` — reads at most `maxBytes`, with the truncation notice the UI expects. */
async function fsReadFile(params: unknown[] | Record<string, unknown> | undefined): Promise<unknown> {
  const [filePath, maxBytes] = positional(params, 2)
  const resolvedPath = resolveSafePath(str(filePath, 'path'))
  const limit = typeof maxBytes === 'number' && maxBytes > 0 ? maxBytes : 5 * 1024 * 1024
  const s = await fs.stat(resolvedPath)
  if (s.size > limit) {
    const content = await readLimited(resolvedPath, limit)
    return content + `\n\n[TRUNCATED: file is ${s.size} bytes, read first ${limit}]`
  }
  return fs.readFile(resolvedPath, 'utf-8')
}

/** `fs.writeFile` — atomic tmp+rename, and the path is re-checked for the *write* target. */
async function fsWriteFile(params: unknown[] | Record<string, unknown> | undefined): Promise<unknown> {
  const [filePath, content] = positional(params, 2)
  const resolvedPath = resolveSafePath(str(filePath, 'path'))
  const text = str(content, 'content')
  await assertSafeWriteTarget(resolvedPath)
  await fs.mkdir(path.dirname(resolvedPath), { recursive: true })
  const tmp = resolvedPath + '.kora-' + crypto.randomBytes(6).toString('hex')
  await fs.writeFile(tmp, text, { encoding: 'utf-8', mode: 0o600 })
  await fs.rename(tmp, resolvedPath)
  return { success: true }
}

/** `fs.readDir` — flat listing with a type flag per entry, no recursion. */
async function fsReadDir(params: unknown[] | Record<string, unknown> | undefined): Promise<unknown> {
  const [dirPath] = positional(params, 1)
  const resolvedPath = resolveSafePath(str(dirPath, 'path'))
  const entries = await fs.readdir(resolvedPath, { withFileTypes: true })
  return entries.map((entry) => ({
    name: entry.name,
    isDirectory: entry.isDirectory(),
    path: path.join(resolvedPath, entry.name),
  }))
}

/** `fs.stat` — size plus ISO timestamps, matching the Electron handler's shape. */
async function fsStat(params: unknown[] | Record<string, unknown> | undefined): Promise<unknown> {
  const [filePath] = positional(params, 1)
  const resolved = resolveSafePath(str(filePath, 'path'))
  const s = await fs.stat(resolved)
  return {
    size: s.size,
    isDirectory: s.isDirectory(),
    isFile: s.isFile(),
    created: s.birthtime.toISOString(),
    modified: s.mtime.toISOString(),
  }
}

/**
 * `fs.exists` — always resolves, never rejects.
 *
 * A resolution failure counts as "does not exist" rather than an error, because the
 * question a caller is asking is about the path, not about our ability to parse it.
 */
async function fsExists(params: unknown[] | Record<string, unknown> | undefined): Promise<unknown> {
  const [filePath] = positional(params, 1)
  try {
    const resolved = resolveSafePath(str(filePath, 'path'))
    await fs.access(resolved)
    return { exists: true }
  } catch {
    return { exists: false }
  }
}

/** `fs.mkdir` — recursive, and treated as a write so the blocklist applies. */
async function fsMkdir(params: unknown[] | Record<string, unknown> | undefined): Promise<unknown> {
  const [dirPath] = positional(params, 1)
  const resolved = resolveSafePath(str(dirPath, 'path'))
  await assertSafeWriteTarget(resolved)
  await fs.mkdir(resolved, { recursive: true })
  return { success: true }
}

/** `fs.deleteFile` — directories are removed recursively, so the write guard is mandatory. */
async function fsDeleteFile(params: unknown[] | Record<string, unknown> | undefined): Promise<unknown> {
  const [filePath] = positional(params, 1)
  const resolved = resolveSafePath(str(filePath, 'path'))
  await assertSafeWriteTarget(resolved)
  const s = await fs.stat(resolved)
  if (s.isDirectory()) {
    await fs.rm(resolved, { recursive: true })
  } else {
    await fs.unlink(resolved)
  }
  return { success: true }
}

/** `fs.rename` — both endpoints are checked, since a move writes to the destination. */
async function fsRename(params: unknown[] | Record<string, unknown> | undefined): Promise<unknown> {
  const [oldPath, newPath] = positional(params, 2)
  const resolvedOld = resolveSafePath(str(oldPath, 'oldPath'))
  const resolvedNew = resolveSafePath(str(newPath, 'newPath'))
  // Moving modifies the SOURCE location too — check both sides.
  await assertSafeWriteTarget(resolvedOld)
  await assertSafeWriteTarget(resolvedNew)
  await fs.mkdir(path.dirname(resolvedNew), { recursive: true })
  await fs.rename(resolvedOld, resolvedNew)
  return { success: true }
}

/** `fs.grep` — ReDoS-guarded pattern, bounded walk, bounded results. */
async function fsGrep(params: unknown[] | Record<string, unknown> | undefined): Promise<unknown> {
  const p = Array.isArray(params) ? (params[0] as Record<string, unknown> | undefined) ?? {} : params ?? {}
  const pattern = str(p.pattern, 'pattern')
  if (pattern.length === 0 || pattern.length > 200) {
    throw new MethodError('pattern must be a non-empty string up to 200 chars')
  }
  const resolvedDir = resolveSafePath(typeof p.dir === 'string' ? p.dir : '.')
  const maxResults = typeof p.maxResults === 'number' ? p.maxResults : 100
  const include = typeof p.include === 'string' ? p.include : undefined
  const ci = p.caseInsensitive !== false
  // ReDoS guard: a user-supplied regex runs inside the core process.
  if (isUnsafeRegex(pattern)) {
    throw new MethodError('Pattern rejected: nested or ambiguous quantifiers are not allowed')
  }
  const re = new RegExp(pattern, ci ? 'i' : '')
  const results: Array<{ file: string; line: number; text: string }> = []

  /** Recursive grep walker: depth 20, skips `node_modules` / `.git` / dotfiles and symlinks. */
  async function walk(dir: string, depth: number): Promise<void> {
    if (results.length >= maxResults || depth > 20) return
    let entries: import('fs').Dirent[]
    try {
      entries = await fs.readdir(dir, { withFileTypes: true, encoding: 'utf-8' } as const) as unknown as import('fs').Dirent[]
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
}

/** `fs.findFiles` — literal-substring search, never a user-compiled regex. */
async function fsFindFiles(params: unknown[] | Record<string, unknown> | undefined): Promise<unknown> {
  const p = Array.isArray(params) ? (params[0] as Record<string, unknown> | undefined) ?? {} : params ?? {}
  const pattern = str(p.pattern, 'pattern')
  const searchDir = typeof p.searchDir === 'string' ? p.searchDir : '~'
  const maxResults = typeof p.maxResults === 'number' ? p.maxResults : 100
  const maxDepth = typeof p.maxDepth === 'number' ? p.maxDepth : 10
  const resolvedDir = resolveSafePath(searchDir)

  // Literal-substring guard (ReDoS): the needle is never compiled as regex.
  const needle = pattern.replace(/[\\/"<>|*?]/g, '').slice(0, 200)
  if (!needle) {
    return { success: false, error: 'Invalid pattern', results: [] }
  }
  const patternRegex = buildFindFilesPattern(pattern)
  if (!patternRegex) {
    return { success: false, error: 'Invalid pattern', results: [] }
  }
  const matcher = patternRegex

  const results: string[] = []
  /** Recursive filename walker: depth-capped, same skip rules as the grep walker. */
  async function walk(dir: string, depth: number): Promise<void> {
    if (results.length >= maxResults || depth > maxDepth) return
    let entries: import('fs').Dirent[]
    try {
      entries = await fs.readdir(dir, { withFileTypes: true, encoding: 'utf-8' } as const) as unknown as import('fs').Dirent[]
    } catch {
      return
    }
    for (const entry of entries) {
      if (results.length >= maxResults) return
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name.startsWith('.')) continue
      const fullPath = path.join(dir, entry.name)
      if (matcher.test(entry.name)) results.push(fullPath)
      if (entry.isDirectory() && !entry.isSymbolicLink()) await walk(fullPath, depth + 1)
    }
  }

  await walk(resolvedDir, 0)
  return { success: true, results, count: results.length }
}

// ── shell ──

export interface ShellExecuteResult {
  stdout: string
  stderr: string
  success: boolean
  blocked: boolean
  requiresConfirmation?: boolean
}

/**
 * `shell.execute` — the denylist runs here, inside the core, before anything is spawned.
 *
 * A `bypassDangerCheck` in the params is read and then ignored on purpose: the caller is
 * untrusted, and the main-process version of this handler is the reference implementation.
 */
async function shellExecute(params: unknown[] | Record<string, unknown> | undefined): Promise<ShellExecuteResult> {
  const [command] = positional(params, 1)
  const cmd = str(command, 'command').trim()

  // The wire caller is untrusted: `bypassDangerCheck` from params is ignored
  // on purpose (docs/CORE_RPC.md §6 — the core re-validates everything).
  if (isDangerousCommand(cmd)) {
    return {
      stdout: '',
      stderr: `Command blocked for safety: ${cmd}. This command is potentially dangerous.`,
      success: false,
      blocked: true,
      requiresConfirmation: true,
    }
  }

  try {
    const { stdout, stderr } = await execAsync(cmd, {
      timeout: 30000,
      maxBuffer: 1024 * 1024 * 10,
    })
    return { stdout: stdout || '', stderr: stderr || '', success: true, blocked: false }
  } catch (error) {
    const e = error as { stdout?: string; message: string }
    return { stdout: e.stdout || '', stderr: e.message, success: false, blocked: false }
  }
}

// ── chats (sanitising persistence, same shape as electron/ipc/chats.ts) ──

/**
 * Rebuild untrusted chat data into the exact shape the app expects.
 *
 * Field by field rather than spreading the parsed object, so a hand-edited file cannot
 * smuggle extra properties into app state. Chats without an `id` are dropped.
 */
export function sanitizeChats(value: unknown): unknown {
  if (!Array.isArray(value)) return []
  return value
    .filter((c): c is Record<string, unknown> => !!c && typeof c === 'object')
    .map((c) => ({
      id: typeof c.id === 'string' ? c.id : '',
      title: typeof c.title === 'string' ? c.title : '',
      createdAt: typeof c.createdAt === 'number' ? c.createdAt : Date.now(),
      updatedAt: typeof c.updatedAt === 'number' ? c.updatedAt : Date.now(),
      messages: Array.isArray(c.messages)
        ? c.messages
            .filter((m): m is Record<string, unknown> => !!m && typeof m === 'object')
            .map((m) => ({
              id: typeof m.id === 'string' ? m.id : '',
              role: typeof m.role === 'string' ? m.role : 'user',
              content: typeof m.content === 'string' ? m.content : '',
              timestamp: typeof m.timestamp === 'number' ? m.timestamp : Date.now(),
            }))
        : [],
    }))
    .filter((c) => c.id)
}

/** A chats store that survives a corrupted file without losing the user's history. */
export interface ChatsStore {
/** Read the history, backing a corrupt file up rather than wiping it. */
  load(): Promise<unknown[]>

  /** Overwrite the history atomically, after sanitising. */
  save(chats: unknown): Promise<void>
}

/** File-backed chats store (atomic tmp+rename, `.corrupt-*` backup). */
/** File-backed chats store: atomic tmp+rename, `.corrupt-*` backup on a parse failure. */
export class FileChatsStore implements ChatsStore {
  /** The file this store owns. */
  constructor(private readonly filePath: string) {}

  /** Read the chats, preserving a corrupted file aside instead of wiping it. */
  async load(): Promise<unknown[]> {
    let content: string
    try {
      content = await fs.readFile(this.filePath, 'utf-8')
    } catch {
      return [] // first run — no file yet
    }
    try {
      const parsed = JSON.parse(content)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      // Corrupted file: back it up instead of silently wiping history.
      const backup = this.filePath + '.corrupt-' + Date.now()
      try {
        await fs.rename(this.filePath, backup)
      } catch {
        // ignore
      }
      return []
    }
  }

  /** Sanitise, then write atomically. */
  async save(chats: unknown): Promise<void> {
    const safe = sanitizeChats(chats)
    const dir = path.dirname(this.filePath)
    await fs.mkdir(dir, { recursive: true })
    const tmp = this.filePath + '.kora-tmp-' + crypto.randomBytes(6).toString('hex')
    await fs.writeFile(tmp, JSON.stringify(safe, null, 2))
    await fs.rename(tmp, this.filePath)
  }
}

/** Bind the chats store to its two `chats.*` methods. */
function chatsMethods(store: ChatsStore): Record<string, MethodSpec> {
  return {
    'chats.load': { capability: 'chats', handler: async () => sanitizeChats(await store.load()) },
    'chats.save': {
      capability: 'chats',
      handler: async (params) => {
        const [chats] = positional(params, 1)
        await store.save(chats)
        return { success: true }
      },
    },
  }
}

// ── table assembly ──

/** Assemble the whole method table — the entry point every shell builds its core from. */
/** The table of every `fs.*` / `shell.*` / `chats.*` method, by name. */
export function createMethodTable(chats: ChatsStore): MethodTable {
  const table: MethodTable = new Map()
  const add = (name: string, capability: MethodSpec['capability'], handler: MethodSpec['handler']) =>
    table.set(name, { capability, handler })

  add('fs.readDir', 'fs', fsReadDir)
  add('fs.readFile', 'fs', fsReadFile)
  add('fs.writeFile', 'fs', fsWriteFile)
  add('fs.mkdir', 'fs', fsMkdir)
  add('fs.stat', 'fs', fsStat)
  add('fs.exists', 'fs', fsExists)
  add('fs.deleteFile', 'fs', fsDeleteFile)
  add('fs.rename', 'fs', fsRename)
  add('fs.grep', 'fs', fsGrep)
  add('fs.findFiles', 'fs', fsFindFiles)
  add('fs.homeDir', 'fs', () => os.homedir())

  add('shell.execute', 'shell', shellExecute)

  for (const [name, spec] of Object.entries(chatsMethods(chats))) table.set(name, spec)

  return table
}

/** `~/.kora` — where the frozen config, chats and mcp files live. */
export function defaultDataDir(): string {
  return path.join(os.homedir(), '.kora')
}
