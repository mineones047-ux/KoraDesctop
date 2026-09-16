import fs from 'fs/promises'
import path from 'path'
import os from 'os'

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

/**
 * Official reference MCP servers, seeded on first run.
 * On Windows, `npx` is a .cmd shim that cannot be spawned directly,
 * so we wrap it with `cmd /c` (the same pattern Claude Desktop uses).
 */
export function defaultServers(): MCPServerConfig[] {
  const npx = (pkg: string, ...extra: string[]): { command: string; args: string[] } =>
    isWindows
      ? { command: 'cmd', args: ['/c', 'npx', '-y', pkg, ...extra] }
      : { command: 'npx', args: ['-y', pkg, ...extra] }

  const filesystem = npx('@modelcontextprotocol/server-filesystem', os.homedir())
  const memory = npx('@modelcontextprotocol/server-memory')
  const thinking = npx('@modelcontextprotocol/server-sequential-thinking')

  return [
    {
      id: 'filesystem',
      name: 'Filesystem',
      command: filesystem.command,
      args: filesystem.args,
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
      enabled: true,
      autoStart: true,
      description: 'Persistent knowledge graph memory across sessions.',
    },
    {
      id: 'sequential-thinking',
      name: 'Sequential Thinking',
      command: thinking.command,
      args: thinking.args,
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

  constructor(filePath: string = DEFAULT_PATH) {
    this.filePath = filePath
  }

  getFilePath(): string {
    return this.filePath
  }

  async load(): Promise<MCPConfigFile> {
    let createdDefaults = false
    try {
      const raw = await fs.readFile(this.filePath, 'utf-8')
      const parsed = JSON.parse(raw) as Partial<MCPConfigFile>
      if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.servers)) {
        throw new Error('Invalid MCP config shape')
      }
      this.data = {
        version: 1,
        servers: parsed.servers.map((s) => this.normalizeServer(s)).filter((s): s is MCPServerConfig => s !== null),
      }
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
