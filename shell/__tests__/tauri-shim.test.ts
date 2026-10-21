import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createKoraBridge, installKoraBridge, isTauri, rpc } from '../tauri-shim'

/**
 * These tests pin the *parity contract* of the Tauri shell: the same `window.kora.*`
 * surface the renderer already uses under Electron. A test must fail if a method is
 * renamed, re-ordered, silently dropped, or if a payload gets reshaped in transit —
 * docs/ROADMAP.md §6.7 forbids exactly that during the port.
 *
 * The suite runs in the default `node` environment (jsdom is not a dependency of
 * this project), so a minimal `window` stand-in is installed here. The shim only
 * ever touches `window.__TAURI_INTERNALS__` and `window.kora`, so a plain object
 * is a faithful host.
 */

interface ShimWindow {
  __TAURI_INTERNALS__?: unknown
  kora?: unknown
}

function shimWindow(): ShimWindow {
  return globalThis as unknown as ShimWindow
}

/** Record every `invoke` call and answer with `result`. */
function mockTauri(result: unknown = { ok: true }) {
  const calls: Array<{ cmd: string; args: Record<string, unknown> }> = []
  const invoke = vi.fn(async (cmd: string, args: Record<string, unknown>) => {
    calls.push({ cmd, args })
    return result
  })
  shimWindow().__TAURI_INTERNALS__ = { invoke }
  return { calls, invoke }
}

function clearTauri() {
  delete shimWindow().__TAURI_INTERNALS__
  delete shimWindow().kora
}

beforeEach(clearTauri)
afterEach(clearTauri)

describe('shell detection', () => {
  it('reports no Tauri runtime under a plain browser/Electron page', () => {
    expect(isTauri()).toBe(false)
    expect(installKoraBridge()).toBe(false)
    expect(shimWindow().kora).toBeUndefined()
  })

  it('installs the bridge when the Tauri runtime is present', () => {
    mockTauri()
    expect(isTauri()).toBe(true)
    expect(installKoraBridge()).toBe(true)
    expect(shimWindow().kora).toBeDefined()
  })

  it('does not overwrite an existing window.kora (Electron keeps its own)', () => {
    mockTauri()
    const existing = { fs: {} }
    shimWindow().kora = existing
    expect(installKoraBridge()).toBe(true)
    expect(shimWindow().kora).toBe(existing)
  })

  it('explains itself instead of failing obscurely when the runtime is missing', async () => {
    await expect(rpc('fs.homeDir')).rejects.toThrow(/Tauri shell is not available/)
  })
})

describe('the only command the shell exposes', () => {
  it('routes every call through kora_rpc', async () => {
    const { calls } = mockTauri()
    // `getHomeDir` is the preload name; the core method is `fs.homeDir` (docs/CORE_RPC §5).
    const kora = createKoraBridge() as { fs: { getHomeDir: () => Promise<unknown> } }
    await kora.fs.getHomeDir()
    expect(calls).toHaveLength(1)
    expect(calls[0].cmd).toBe('kora_rpc')
    expect(calls[0].args.method).toBe('fs.homeDir')
  })
})

describe('fs method parity with electron/preload.ts', () => {
  it('exposes every fs method the renderer calls', () => {
    const kora = createKoraBridge() as { fs: Record<string, unknown> }
    for (const name of [
      'readDir', 'readFile', 'writeFile', 'patchFile', 'grep', 'getHomeDir',
      'deleteFile', 'rename', 'copy', 'mkdir', 'stat', 'exists', 'findFiles',
    ]) {
      expect(typeof kora.fs[name], `fs.${name} must exist`).toBe('function')
    }
  })

  it('sends readFile as [path, maxBytes] in the ported positional order', async () => {
    const { calls } = mockTauri('file body')
    const kora = createKoraBridge() as { fs: { readFile: (p: string, m?: number) => Promise<unknown> } }
    const out = await kora.fs.readFile('C:/x.txt', 1024)
    expect(out).toBe('file body')
    expect(calls[0].args.method).toBe('fs.readFile')
    expect(calls[0].args.params).toEqual(['C:/x.txt', 1024])
  })

  it('passes a payload through untouched', async () => {
    const payload = { count: 2, results: [{ file: 'a', line: 1, text: 'x' }] }
    const { calls } = mockTauri(payload)
    const kora = createKoraBridge() as { fs: { grep: (d: string, p: string) => Promise<unknown> } }
    expect(await kora.fs.grep('C:/dir', 'needle')).toBe(payload)
    expect(calls[0].args.params).toEqual({ dir: 'C:/dir', pattern: 'needle' })
  })
})

describe('the security invariant survives the port', () => {
  it('never forwards bypassDangerCheck to the core', async () => {
    const { calls } = mockTauri({ success: false, blocked: true })
    const kora = createKoraBridge() as {
      shell: { execute: (c: string, o?: unknown) => Promise<unknown> }
    }
    // The caller tries to skip the denylist. The core must not even see the flag.
    await kora.shell.execute('format C:', { bypassDangerCheck: true })
    expect(calls[0].args.params).toEqual(['format C:'])
  })

  it('refuses to pretend the unported domains work', async () => {
    const kora = createKoraBridge() as {
      ai: { chat: () => Promise<never> }
      mcp: { list: () => Promise<never> }
      system: { getInfo: () => Promise<never> }
      web: { fetch: (url: string) => Promise<never> }
    }
    // An unported domain is an *object* with the Electron method names (the shape
    // rule in shell/tauri-shim.ts), so existing call sites keep working and fail with
    // an explanation instead of `TypeError: window.kora.mcp is not a function`.
    await expect(kora.ai.chat()).rejects.toThrow(/not ported to the Rust core yet/)
    await expect(kora.mcp.list()).rejects.toThrow(/"mcp\.list" is not ported/)
    await expect(kora.system.getInfo()).rejects.toThrow(/"system\.getInfo" is not ported/)
    await expect(kora.web.fetch('https://example.com')).rejects.toThrow(/"web\.fetch"/)
  })
})

describe('config and chats', () => {
  it('sends config.set as [key, value]', async () => {
    const { calls } = mockTauri({ success: true })
    const kora = createKoraBridge() as { config: { set: (k: string, v: unknown) => Promise<unknown> } }
    await kora.config.set('language', 'ru')
    expect(calls[0].args.params).toEqual(['language', 'ru'])
  })

  it('routes saveSync through the async save method', async () => {
    // Tauri has no synchronous reply channel, so saveSync must not be a lie: the call
    // returns void like the Electron bridge, and the write is dispatched immediately.
    const { calls } = mockTauri({ success: true })
    const kora = createKoraBridge() as { chats: { saveSync: (c: unknown) => void } }
    expect(kora.chats.saveSync([{ id: 'c1' }])).toBeUndefined()
    expect(calls.map((c) => c.args.method)).toEqual(['chats.save'])
    expect(calls[0].args.params).toEqual([[{ id: 'c1' }]])
  })
})
