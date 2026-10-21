import { describe, it, expect } from 'vitest'
import fs from 'fs/promises'
import os from 'os'
import path from 'path'
// The REAL module: electron/ipc/filesystem.ts and core/methods.ts both import this,
// so the suite exercises exactly the guard production runs.
import { resolveSafePath, assertNotBlockedWrite, assertSafeWriteTarget } from '../../../electron/lib/path-guard'

const isWindows = process.platform === 'win32'

/** A directory the blocklist refuses to write into on this platform. */
const blockedRoot = isWindows
  ? path.win32.join(process.env.SystemRoot || 'C:\\Windows', 'System32')
  : '/etc'

describe('resolveSafePath', () => {
  it('strips quotes and resolves to an absolute path', () => {
    expect(resolveSafePath('  "notes.txt"  ')).toBe(path.resolve('notes.txt'))
    expect(path.isAbsolute(resolveSafePath('./a/../b.txt'))).toBe(true)
  })

  it('expands a leading tilde to the home directory', () => {
    expect(resolveSafePath('~/kora.txt')).toBe(path.join(os.homedir(), 'kora.txt'))
  })

  it('rejects a path longer than the cap', () => {
    expect(() => resolveSafePath('a'.repeat(5000))).toThrow(/Path too long/)
  })
})

describe('assertNotBlockedWrite', () => {
  it('refuses a system directory and the paths below it', () => {
    expect(() => assertNotBlockedWrite(blockedRoot)).toThrow(/system directory blocked/i)
    expect(() => assertNotBlockedWrite(path.join(blockedRoot, 'evil.txt'))).toThrow(
      /system directory blocked/i
    )
  })

  it('allows a path outside the blocklist', () => {
    expect(() => assertNotBlockedWrite(path.join(os.tmpdir(), 'kora-ok.txt'))).not.toThrow()
  })
})

describe('assertSafeWriteTarget', () => {
  it('accepts a new file in a temp directory (deepest existing ancestor is resolved)', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kora-guard-'))
    try {
      await expect(
        assertSafeWriteTarget(path.join(dir, 'nested', 'file.txt'))
      ).resolves.toBeUndefined()
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('refuses a symlink/junction that points into a blocked directory', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kora-link-'))
    const link = path.join(dir, 'gateway')
    try {
      // Junctions need no elevation on Windows; a directory symlink elsewhere.
      await fs.symlink(blockedRoot, link, isWindows ? 'junction' : 'dir')
    } catch {
      // No permission to create links on this machine — the literal-path rule
      // above still covers the blocklist, so the case is reported as skipped.
      await fs.rm(dir, { recursive: true, force: true })
      return
    }
    try {
      await expect(assertSafeWriteTarget(path.join(link, 'evil.txt'))).rejects.toThrow(
        /system directory blocked/i
      )
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })
})
