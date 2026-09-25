import fs from 'fs/promises'
import fsSync from 'fs'
import path from 'path'
import os from 'os'
import { app } from 'electron'

export interface MCPServerConfig {
  id: string
  name: string
  command: string
  args?: string[]
  env?: Record<string, string>
  cwd?: string
  enabled: boolean
  autoStart?: boolean
  description?: string
  requestTimeoutMs?: number
}

export interface MCPConfigFile {
  version: 1
  servers: MCPServerConfig[]
}

const DEFAULT_PATH = path.join(os.homedir(), '.kora', 'mcp.json')

const DEFAULT_CONFIG: MCPConfigFile = {
  version: 1,
  servers: [],
}

const isWindows = process.platform === 'win32'

type Launch = { command: string; args: string[]; env?: Record<string, string> }

/** Project root: app.asar (packaged) or the repo dir (dev). */
function appRoot(): string {
  try {
    return app.getAppPath()
  } catch {
    return path.resolve(__dirname, '..')
  }
}

/**
 * Resolve a launchable script for an npm package:
 *  1. the self-contained bundle in `dist-electron/mcp/` shipped with the app
 *     (built by scripts/build-main.cjs) — the packaged-app path;
 *  2. the package's bin inside `node_modules` — dev fallback / custom packages.
 * A child process cannot be spawned from inside an asar archive, so any path
 * under `app.asar` is rewritten to `app.asar.unpacked` — and when there is no
 * unpacked copy we refuse to launch (the caller falls back to `npx`).
 */
function localEntry(pkg: string): string | null {
  try {
    const segs = pkg.split('/')
    const base = segs[segs.length - 1]

    const bundled = spawnable(path.join(appRoot(), 'dist-electron', 'mcp', `${base}.mjs`))
    if (bundled) return bundled

    const pkgDir = path.join(appRoot(), 'node_modules', ...segs)
    const meta = JSON.parse(fsSync.readFileSync(path.join(pkgDir, 'package.json'), 'utf-8'))
    const binField = meta?.bin
    let rel: unknown
    if (typeof binField === 'string') rel = binField
    else if (binField && typeof binField === 'object') rel = binField[base] ?? Object.values(binField)[0]
    if (typeof rel !== 'string') return null

    return spawnable(path.join(pkgDir, String(rel)))
  } catch {
    return null
  }
}

/** Real file the OS can exec: outside asar, or the unpacked mirror of one. */
function spawnable(p: string): string | null {
  if (!p.includes(`app.asar${path.sep}`)) return fsSync.existsSync(p) ? p : null
  const unpacked = p.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`)
  return fsSync.existsSync(unpacked) ? unpacked : null
}

/**
 * Launch a bundled npm package directly via the Electron binary in Node mode
 * (`ELECTRON_RUN_AS_NODE=1`) — one process instead of a whole
 * `cmd -> npx -> node` tree (ROADMAP Phase 0: "stop spawning npx for MCP
 * servers"; also removes the Windows zombie-process problem from FIXES.md).
 */
function localLaunch(pkg: string, extra: string[] = []): Launch | null {
  const entry = localEntry(pkg)
  if (!entry) return null
  return { command: process.execPath, args: [entry, ...extra], env: { ELECTRON_RUN_AS_NODE: '1' } }
}

/** Recognize a legacy `[-y <pkg> …]` launch: bare `npx` or via `cmd /c npx`. */
function npxLaunch(s: MCPServerConfig): { pkg: string; extra: string[] } | null {
  const a = s.args ?? []
  const head = s.command === 'npx' ? 0 : s.command === 'cmd' && a[0] === '/c' && a[1] === 'npx' ? 2 : -1
  if (head === -1 || a[head] !== '-y' || !a[head + 1]) return null
  return { pkg: a[head + 1], extra: a.slice(head + 2) }
}

/**
 * Official reference MCP servers, seeded on first run. Each server is launched
 * from the app's own node_modules (single process, no npx) whenever the
 * package is installed; the classic `npx -y` form is only a fallback for
 * packages that are not bundled.
 */
export function defaultServers(): MCPServerConfig[] {
  const npx = (pkg: string, ...extra: string[]): Launch =>
    isWindows
      ? { command: 'cmd', args: ['/c', 'npx', '-y', pkg, ...extra] }
      : { command: 'npx', args: ['-y', pkg, ...extra] }
  const via = (pkg: string, ...extra: string[]): Launch => localLaunch(pkg, extra) ?? npx(pkg, ...extra)

  const filesystem = via('@modelcontextprotocol/server-filesystem', os.homedir())
  const memory = via('@modelcontextprotocol/server-memory')
  const thinking = via('@modelcontextprotocol/server-sequential-thinking')

  return [
    {
      id: 'filesystem',
      name: 'Filesystem',
      command: filesystem.command,
      args: filesystem.args,
      env: filesystem.env,
      enabled: false,
      autoStart: false,
      description:
        'File system access to your home folder. Disabled by default: the agent can read/write files without per-action confirmation.',
    },
    {
      id: 'memory',
      name: 'Memory (knowledge graph)',
      command: memory.command,
      args: memory.args,
      env: memory.env,
      enabled: true,
      autoStart: true,
      description: 'Persistent knowledge graph memory across sessions.',
    },
    {
      id: 'sequential-thinking',
      name: 'Sequential Thinking',
      command: thinking.command,
      args: thinking.args,
      env: thinking.env,
      enabled: true,
      autoStart: true,
      description: 'Structured multi-step reasoning tool for complex problems.',
    },
  ]
}

export class MCPConfig {
  private filePath: string
  private data: MCPConfigFile = { ...DEFAULT_CONFIG, servers: [] }
  private writeQueue: Promise<void> = Promise.resolve()
  private loaded = false

  constructor(filePath: string = DEFAULT_PATH) {
    this.filePath = filePath
  }

  getFilePath(): string {
    return this.filePath
  }

  async load(): Promise<MCPConfigFile> {
    if (this.loaded) return this.data
    let createdDefaults = false
    try {
      const raw = await fs.readFile(this.filePath, 'utf-8')
      const parsed = JSON.parse(raw) as Partial<MCPConfigFile>
      if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.servers)) {
        throw new Error('Invalid MCP config shape')
      }
      // Migration: rewrite legacy `npx -y <pkg>` launches to the bundled
      // single-process form whenever the package ships with the app.
      let migrated = false
      const servers = parsed.servers
        .map((s) => this.normalizeServer(s))
        .filter((s): s is MCPServerConfig => s !== null)
        .map((s) => {
          const legacy = npxLaunch(s)
          if (!legacy) return s
          const local = localLaunch(legacy.pkg, legacy.extra)
          if (!local) return s
          migrated = true
          return { ...s, command: local.command, args: local.args, env: { ...s.env, ...local.env } }
        })
      this.data = { version: 1, servers }
      if (migrated) this.scheduleWrite()
    } catch (err: any) {
      if (err?.code !== 'ENOENT') {
        console.error('[MCP] failed to load config, using defaults:', err.message)
        try {
          await fs.rename(this.filePath, this.filePath + '.bak')
        } catch {
          // ignore backup failure
        }
      }
      // First run: seed the config with the built-in default servers
      createdDefaults = true
      this.data = { ...DEFAULT_CONFIG, servers: defaultServers() }
    }
    if (createdDefaults) {
      this.scheduleWrite()
    }
    this.loaded = true
    return this.data
  }

  getAll(): MCPServerConfig[] {
    return this.data.servers.map((s) => ({ ...s, env: s.env ? { ...s.env } : undefined, args: s.args ? [...s.args] : undefined }))
  }

  get(id: string): MCPServerConfig | null {
    const s = this.data.servers.find((x) => x.id === id)
    return s ? { ...s, env: s.env ? { ...s.env } : undefined, args: s.args ? [...s.args] : undefined } : null
  }

  upsert(server: MCPServerConfig): void {
    const norm = this.normalizeServer(server)
    if (!norm) throw new Error('Invalid server config')
    const idx = this.data.servers.findIndex((s) => s.id === norm.id)
    if (idx >= 0) {
      this.data.servers[idx] = norm
    } else {
      this.data.servers.push(norm)
    }
    this.scheduleWrite()
  }

  remove(id: string): boolean {
    const before = this.data.servers.length
    this.data.servers = this.data.servers.filter((s) => s.id !== id)
    if (this.data.servers.length !== before) {
      this.scheduleWrite()
      return true
    }
    return false
  }

  setEnabled(id: string, enabled: boolean): boolean {
    const s = this.data.servers.find((x) => x.id === id)
    if (!s) return false
    s.enabled = enabled
    this.scheduleWrite()
    return true
  }

  private normalizeServer(input: unknown): MCPServerConfig | null {
    if (!input || typeof input !== 'object') return null
    const s = input as Record<string, unknown>
    const name = typeof s.name === 'string' ? s.name.trim() : ''
    const command = typeof s.command === 'string' ? s.command.trim() : ''
    if (!name || !command) return null

    const args = Array.isArray(s.args) ? s.args.filter((a): a is string => typeof a === 'string') : undefined
    const env = this.normalizeEnv(s.env)
    const cwd = typeof s.cwd === 'string' && s.cwd.trim() ? s.cwd : undefined
    const id = typeof s.id === 'string' && s.id.trim() ? s.id.trim() : `srv_${Date.now().toString(36)}`
    const enabled = s.enabled === false ? false : true
    const autoStart = s.autoStart === false ? false : true
    const description = typeof s.description === 'string' ? s.description : undefined
    const requestTimeoutMs =
      typeof s.requestTimeoutMs === 'number' && s.requestTimeoutMs > 0 ? s.requestTimeoutMs : undefined

    return {
      id,
      name,
      command,
      args,
      env,
      cwd,
      enabled,
      autoStart,
      description,
      requestTimeoutMs,
    }
  }

  private normalizeEnv(input: unknown): Record<string, string> | undefined {
    if (!input || typeof input !== 'object') return undefined
    const env: Record<string, string> = {}
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      if (typeof v === 'string') env[k] = v
    }
    return Object.keys(env).length > 0 ? env : undefined
  }

  private scheduleWrite(): void {
    this.writeQueue = this.writeQueue.then(() => this.persist()).catch((err) => {
      console.error('[MCP] persist error:', err)
    })
  }

  private async persist(): Promise<void> {
    const dir = path.dirname(this.filePath)
    await fs.mkdir(dir, { recursive: true })
    const tmp = this.filePath + '.tmp'
    const payload = JSON.stringify(this.data, null, 2)
    await fs.writeFile(tmp, payload, 'utf-8')
    await fs.rename(tmp, this.filePath)
  }
}
