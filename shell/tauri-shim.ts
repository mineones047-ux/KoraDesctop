/**
 * Tauri shell adapter — the `window.kora.*` bridge for the Rust core.
 *
 * The React renderer must not change when the shell changes (docs/ROADMAP.md §6.7):
 * every component already calls `window.kora.*`, exactly as it does under Electron.
 * This module replaces `electron/preload.ts` — the same object, the same method
 * names, the same argument order and the same return shapes, but each call is
 * forwarded to the `kora-rpc/1` core through Tauri's `invoke()` instead of an
 * Electron IPC channel.
 *
 * Two rules that survive the port:
 *   1. the renderer has no privileged access of its own — `kora_rpc` is the only
 *      command the core answers, and the core re-validates every input
 *      (docs/CORE_RPC.md §6);
 *   2. nothing is re-interpreted here. A `{ success, error, data }`-shaped payload
 *      from the core is passed through untouched, because reshaping it during the
 *      port is forbidden.
 *
 * The Electron build is unaffected: `installKoraBridge` only takes over when the
 * Tauri runtime is present.
 *
 * ── The shape rule ────────────────────────────────────────────────────────────
 * A domain that the Rust core does not serve yet is still exposed as an **object
 * with the same method names** as the Electron bridge, and every one of those
 * methods refuses with an explicit message. Exposing a bare function instead
 * would turn `window.kora.system.getInfo()` into a `TypeError: … is not a
 * function` deep inside a component — a crash with no explanation. The parity
 * test in `shell/__tests__/tauri-shim.test.ts` enforces this against
 * `electron/preload.ts` and `src/types/index.ts`.
 */

/** The single command the core answers (`crates/kora-desktop`). */
const RPC_COMMAND = 'kora_rpc'

/**
 * The shell-level command for things the *shell* owns rather than the core:
 * the window controls. Kept separate from `kora_rpc` on purpose — window
 * management is not a core method and must not become one.
 */
const WINDOW_COMMAND = 'kora_window'

type Params = unknown[] | Record<string, unknown>

/** Minimal shape of the Tauri runtime we depend on. Declared locally so an
 *  Electron-only build does not need `@tauri-apps/api` installed. */
interface TauriInternals {
  invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T>
}

declare global {
  interface Window {
    __TAURI_INTERNALS__?: TauriInternals
  }
}

/**
 * The global object hosting the bridge.
 *
 * `globalThis` rather than a bare `window`: in the renderer these are the same
 * object, and this also lets the contract be tested in the plain `node` vitest
 * environment, which has no `window` at all.
 */
function host(): TauriInternals | undefined {
  return (globalThis as { __TAURI_INTERNALS__?: TauriInternals }).__TAURI_INTERNALS__
}

/** Is the Tauri shell present? Electron reaches this as `false`. */
export function isTauri(): boolean {
  return typeof host()?.invoke === 'function'
}

/** Forward one `kora-rpc/1` call to the core. */
export async function rpc<T>(method: string, params: Params = []): Promise<T> {
  const internals = host()
  if (!internals) {
    throw new Error(
      `Kora: the Tauri shell is not available (method "${method}" cannot be dispatched). ` +
        'Under Electron this bridge is installed by electron/preload.ts instead.',
    )
  }
  return internals.invoke<T>(RPC_COMMAND, { method, params })
}

/** Forward one shell-level call (window controls) to the Tauri shell. */
async function shellCall<T>(action: string): Promise<T> {
  const internals = host()
  if (!internals) {
    throw new Error(
      `Kora: the Tauri shell is not available (window action "${action}" cannot be dispatched).`,
    )
  }
  return internals.invoke<T>(WINDOW_COMMAND, { action })
}

// ── Domains the Rust core does not serve yet ─────────────────────────────────

/**
 * A method that is not ported to the Rust core yet.
 *
 * It *rejects* rather than returning a fake value: a half-working shell is
 * harder to debug than one that says what is missing. The message names the
 * exact method and the phase, so the log says what to do next.
 */
function notPorted(domain: string, method: string): (...args: unknown[]) => Promise<never> {
  return async () => {
    throw new Error(
      `Kora: "${domain}.${method}" is not ported to the Rust core yet (docs/ROADMAP.md §7, phase P3). ` +
        'Run the Electron build for these features.',
    )
  }
}

/**
 * Build a domain object whose every method refuses with the same message.
 *
 * The method list is the *Electron* list, so the renderer's call sites keep
 * working unchanged — only the outcome changes (an explicit refusal instead of
 * a `TypeError`).
 */
function notPortedDomain<T extends string>(
  domain: string,
  methods: readonly T[],
): Record<T, (...args: unknown[]) => Promise<never>> {
  const out = {} as Record<T, (...args: unknown[]) => Promise<never>>
  for (const method of methods) {
    out[method] = notPorted(domain, method)
  }
  return out
}

/**
 * An event subscription the Rust core cannot serve yet.
 *
 * Unlike a command, a subscription cannot reject: the caller expects a
 * *function* back (`const off = window.kora.mcp.onChanged(...)`) and a rejected
 * promise in that position would be silently dropped. So it returns a no-op
 * unsubscribe and says so once, loudly, in the console.
 */
function unsupportedSubscription(domain: string, method: string): () => void {
  let warned = false
  return () => {
    if (warned) return
    warned = true
    console.warn(
      `Kora: "${domain}.${method}" has no Rust implementation yet — the callback will never fire. ` +
        'Run the Electron build for this feature.',
    )
  }
}

// ── The window state the shell owns ──────────────────────────────────────────

/**
 * The maximise state of the Tauri window.
 *
 * The renderer reads it **synchronously** (`useState(window.kora.window.isMaximized())`),
 * and the port rule forbids changing the renderer — so the shell keeps the value
 * locally instead of asking over an async channel.
 *
 * Accuracy: the value is fetched from the shell the first time the renderer
 * reads it (or subscribes to it), and again whenever the window is focused, so a
 * window maximised by dragging it to the screen edge is picked up the next time
 * the user comes back to the app. A change that happens *while* the app stays
 * focused and is never followed by a focus event is the one case the value can
 * lag — the title bar icon, nothing more.
 *
 * Nothing is asked at construction time: the Electron preload installs the
 * bridge without dispatching anything, and the parity rule (§6.7) means this
 * adapter must not dispatch a request the renderer did not make either. An
 * eager call here would also be the first thing the shell sees, ahead of the
 * renderer's own first call.
 */
class WindowState {
  private maximized = false
  private listeners = new Set<(value: boolean) => void>()

  get isMaximized(): boolean {
    return this.maximized
  }

  /** Set the value and notify the subscribers. */
  set(value: boolean): void {
    if (this.maximized === value) return
    this.maximized = value
    for (const listener of [...this.listeners]) {
      try {
        listener(value)
      } catch (err) {
        // One broken subscriber must not stop the others from being told.
        console.error('[Kora] window state listener failed:', err)
      }
    }
  }

  /** Subscribe to maximise changes. Returns the unsubscribe function. */
  subscribe(callback: (value: boolean) => void): () => void {
    this.listeners.add(callback)
    return () => {
      this.listeners.delete(callback)
    }
  }
}

// ── The method lists of the domains the core does not serve yet ─────────────
//
// These mirror `electron/preload.ts` exactly. `shell/__tests__/bridge-parity.test.ts`
// compares them with the preload and with `src/types/index.ts`, so a method added
// to one place and forgotten in the other fails the suite.

/** `window.kora.system.*` — see electron/preload.ts. */
const SYSTEM_METHODS = [
  'getInfo',
  'getProcesses',
  'openApp',
  'killProcess',
  'shutdown',
  'restart',
  'sleep',
  'lock',
  'volume',
  'volumeUp',
  'volumeDown',
  'mute',
  'brightness',
  'windows',
] as const

/** `window.kora.mcp.*` — `onChanged` is a subscription, not a command. */
const MCP_METHODS = [
  'list',
  'getConfig',
  'listTools',
  'start',
  'stop',
  'restart',
  'upsert',
  'remove',
  'setEnabled',
  'call',
  'diagnostics',
] as const

/** `window.kora.obsidian.*` */
const OBSIDIAN_METHODS = ['scan', 'readNote', 'pickVault'] as const

/** `window.kora.localAI.*` — `onProgress` is a subscription, not a command. */
const LOCAL_AI_METHODS = [
  'profile',
  'search',
  'files',
  'downloadStt',
  'download',
  'cancel',
  'pause',
  'partials',
  'scanDisks',
  'startExternal',
  'list',
  'remove',
  'engineStatus',
  'downloadEngine',
  'start',
  'stop',
] as const

// ── The bridge ───────────────────────────────────────────────────────────────

/**
 * Build the `window.kora.*` object.
 *
 * The domains the Rust core serves today (`fs`, `shell`, `config`, `chats`) are
 * forwarded to the core; the rest keep the Electron shape and refuse with an
 * explicit message, so a missing feature is visible instead of mysterious.
 */
export function createKoraBridge(): unknown {
  const windowState = new WindowState()

  // At most one `is_maximized` request in flight: the renderer reads the value
  // during render and subscribes right after, so two triggers on mount are normal
  // and must not turn into two round trips.
  let refreshInFlight: Promise<void> | null = null

  /** Refresh the maximise state from the shell. Failures are not fatal. */
  const refreshMaximized = (): Promise<void> => {
    if (refreshInFlight) return refreshInFlight
    refreshInFlight = shellCall<boolean>('is_maximized')
      .then((maximized) => windowState.set(Boolean(maximized)))
      .catch(() => {
        // The window command is optional: an older shell simply has no window
        // controls, and the locally tracked value stays good enough.
      })
      .finally(() => {
        refreshInFlight = null
      })
    return refreshInFlight
  }

  // Refreshed on first use (see the `window` domain below) and whenever the
  // window regains focus, so an edge-snap maximise is picked up on return.
  if (typeof globalThis.addEventListener === 'function') {
    globalThis.addEventListener('focus', () => void refreshMaximized())
  }

  return {
    window: {
      minimize: async () => {
        await shellCall('minimize')
      },
      maximize: async () => {
        await shellCall('maximize')
        // The shell toggles; ask it what it actually did rather than guessing.
        await refreshMaximized()
      },
      close: async () => {
        await shellCall('close')
      },
      // The renderer reads this synchronously, so the first read returns the
      // locally tracked value *and* asks the shell; the answer arrives through
      // `onMaximizedChange`, which the title bar subscribes to right after.
      isMaximized: () => {
        void refreshMaximized()
        return windowState.isMaximized
      },
      onMaximizedChange: (callback: (value: boolean) => void) => {
        void refreshMaximized()
        return windowState.subscribe(callback)
      },
    },

    fs: {
      readDir: (path: string) => rpc('fs.readDir', [path]),
      readFile: (path: string, maxBytes?: number) => rpc('fs.readFile', [path, maxBytes]),
      writeFile: (path: string, content: string) => rpc('fs.writeFile', [path, content]),
      // No `fs.patchFile` in the Rust core yet: the method is intentionally absent
      // rather than silently routed to some other one.
      patchFile: notPorted('fs', 'patchFile'),
      grep: (dirPath: string, pattern: string, options?: Record<string, unknown>) =>
        rpc('fs.grep', { dir: dirPath, pattern, ...options }),
      getHomeDir: () => rpc('fs.homeDir', []),
      deleteFile: (path: string) => rpc('fs.deleteFile', [path]),
      rename: (oldPath: string, newPath: string) => rpc('fs.rename', [oldPath, newPath]),
      copy: (oldPath: string, newPath: string) => rpc('fs.copy', [oldPath, newPath]),
      mkdir: (path: string) => rpc('fs.mkdir', [path]),
      stat: (path: string) => rpc('fs.stat', [path]),
      exists: (path: string) => rpc('fs.exists', [path]),
      findFiles: (pattern: string, options?: Record<string, unknown>) =>
        rpc('fs.findFiles', { pattern, ...options }),
    },

    shell: {
      // `bypassDangerCheck` is accepted for signature parity with the Electron
      // bridge, but the core ignores it on purpose: the caller is untrusted, so the
      // denylist is never skippable from the wire.
      execute: (command: string, _options?: unknown) => rpc('shell.execute', [command]),
    },

    config: {
      get: () => rpc('config.get', []),
      set: (key: string, value: unknown) => rpc('config.set', [key, value]),
    },

    chats: {
      load: () => rpc('chats.load', []),
      save: (chats: unknown) => rpc('chats.save', [chats]),
      /**
       * Flush the chat history before the window goes away.
       *
       * Electron answers `chats:saveSync` on a blocking channel, so the write
       * completes before the renderer is torn down. Tauri has no synchronous
       * channel, so the write is dispatched and the promise is intentionally
       * dropped — the call still returns `void`, so the renderer contract does
       * not change.
       *
       * Durability does not depend on this one call: the renderer also flushes
       * on `pagehide` / `visibilitychange` through the async `chats.save`, and
       * the Rust core writes in-process, so the file is on disk microseconds
       * after the call is dispatched.
       */
      saveSync: (chats: unknown) => {
        void rpc('chats.save', [chats]).catch((err: unknown) => {
          console.error('[Kora] failed to flush the chat history:', err)
        })
      },
    },

    ai: {
      chat: notPorted('ai', 'chat'),
      chatStream: notPorted('ai', 'chatStream'),
      listModels: notPorted('ai', 'listModels'),
      testConnection: notPorted('ai', 'testConnection'),
    },

    tts: {
      synthesize: notPorted('tts', 'synthesize'),
      voices: notPorted('tts', 'voices'),
    },

    stt: { transcribe: notPorted('stt', 'transcribe') },

    clipboard: {
      read: notPorted('clipboard', 'read'),
      write: notPorted('clipboard', 'write'),
    },

    web: {
      search: notPorted('web', 'search'),
      fetch: notPorted('web', 'fetch'),
    },

    system: notPortedDomain('system', SYSTEM_METHODS),

    mcp: {
      ...notPortedDomain('mcp', MCP_METHODS),
      onChanged: unsupportedSubscription('mcp', 'onChanged'),
    },

    obsidian: notPortedDomain('obsidian', OBSIDIAN_METHODS),

    localAI: {
      ...notPortedDomain('localAI', LOCAL_AI_METHODS),
      onProgress: unsupportedSubscription('localAI', 'onProgress'),
    },
  }
}

/**
 * Install the bridge when running under Tauri.
 *
 * Returns `true` when the shim took over. Under Electron it returns `false` and
 * leaves `window.kora` to `electron/preload.ts`, so both shells coexist in one
 * codebase — and in one CI run — without either special-casing the other.
 */
export function installKoraBridge(): boolean {
  if (!isTauri()) return false
  const g = globalThis as { kora?: unknown }
  if (!g.kora) {
    g.kora = createKoraBridge()
  }
  return true
}
