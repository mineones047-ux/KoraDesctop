/**
 * MCP manager: owns one MCPClient per configured server for the app lifetime.
 *
 * Responsibilities: autostart, lazy start on first use, hot reload on config
 * change, tool-cache invalidation on `notifications/tools/list_changed`, a start
 * mutex (no double spawn) and graceful shutdown — on Windows via
 * `taskkill /T /F` so the whole `cmd -> npx -> node` tree dies (otherwise
 * zombie processes survive stop/restart/exit).
 */
import { EventEmitter } from 'events'
import { MCPClient } from './client'
import { MCPConfig, MCPServerConfig } from './config'
import { MCPTool } from './protocol'

export interface MCPServerStatus {
  id: string
  name: string
  enabled: boolean
  running: boolean
  toolCount: number
  error?: string
  serverInfo?: { name: string; version: string }
}

export interface MCPToolWithServer extends MCPTool {
  serverId: string
  serverName: string
  fullName: string
}

/**
 * Owns all MCP clients for the lifetime of the app. Handles:
 *  - autostart on app launch
 *  - lazy start on first use
 *  - hot-reload on config change
 *  - tool cache invalidation on `notifications/tools/list_changed`
 *  - graceful shutdown
 */
export class MCPManager extends EventEmitter {
  private config: MCPConfig
  private clients = new Map<string, MCPClient>()
  private toolCache = new Map<string, MCPToolWithServer[]>()
  private toolIndex = new Map<string, { serverId: string; toolName: string }>()
  private startingPromises = new Map<string, Promise<MCPServerStatus>>()
  /** Set by `shutdown()`; aborts starts still in flight (lazy-init quit race). */
  private disposed = false

  constructor(config: MCPConfig) {
    super()
    this.config = config
  }

  /** The config store, for callers that need to read or edit the raw profile. */
  getConfig(): MCPConfig {
    return this.config
  }

  /**
   * Autostart every enabled server. Failures are swallowed per server: one bad entry in
   * the profile must not stop the others from coming up, which is why this is
   * `allSettled` rather than `all`.
   */
  async init(): Promise<void> {
    if (this.disposed) return
    await this.config.load()
    const servers = this.config.getAll()
    await Promise.allSettled(
      servers.filter((s) => s.enabled && s.autoStart !== false).map((s) => this.startServer(s.id)),
    )
  }

  /**
   * Stop every server and clear the caches.
   *
   * Sets `disposed` first, so a `startServer` still in flight bails out instead of adding
   * a client to a map that is being emptied — the lazy-init race on quit.
   */
  async shutdown(): Promise<void> {
    this.disposed = true
    const stops = Array.from(this.clients.values()).map((c) =>
      c.stop().catch((err) => console.error(`[MCP] stop error for "${c.name}":`, err)),
    )
    await Promise.allSettled(stops)
    this.clients.clear()
    this.toolCache.clear()
    this.toolIndex.clear()
  }

  /** Config-derived status for every server, running or not — the settings panel's view. */
  listServers(): MCPServerStatus[] {
    return this.config.getAll().map((s) => {
      const client = this.clients.get(s.id)
      const tools = this.toolCache.get(s.id) ?? []
      return {
        id: s.id,
        name: s.name,
        enabled: s.enabled,
        running: client?.isRunning() ?? false,
        toolCount: tools.length,
        serverInfo: client?.getServerInfo()
          ? { name: client.getServerInfo()!.serverInfo.name, version: client.getServerInfo()!.serverInfo.version }
          : undefined,
      }
    })
  }

  /** The stored definition of one server, or `null` when the id is unknown. */
  getServerConfig(id: string): MCPServerConfig | null {
    return this.config.get(id)
  }

  /**
   * Start a server, or return the running one.
   *
   * Concurrent calls share one in-flight promise: without it, the settings panel and the
   * agent's first tool call racing each other would spawn two processes for one server.
   */
  async startServer(id: string): Promise<MCPServerStatus> {
    const cfg = this.config.get(id)
    if (!cfg) throw new Error(`MCP server "${id}" not found`)
    if (!cfg.enabled) throw new Error(`MCP server "${cfg.name}" is disabled`)
    if (this.disposed) throw new Error('MCP manager is shutting down')

    const existing = this.clients.get(id)
    if (existing?.isRunning()) {
      return this.toStatus(cfg, existing)
    }

    // Coalesce concurrent start requests into one startup sequence
    const inFlight = this.startingPromises.get(id)
    if (inFlight) return inFlight

    const startPromise = this.doStart(cfg).finally(() => {
      this.startingPromises.delete(id)
    })
    this.startingPromises.set(id, startPromise)
    return startPromise
  }

  /** The real start, after the dedup in `startServer`. */
  private async doStart(cfg: MCPServerConfig): Promise<MCPServerStatus> {
    const id = cfg.id
    const existing = this.clients.get(id)
    if (existing) {
      await existing.stop().catch(() => {})
      this.clients.delete(id)
    }

    const client = new MCPClient({
      name: cfg.name,
      command: cfg.command,
      args: cfg.args,
      env: cfg.env,
      cwd: cfg.cwd,
      requestTimeoutMs: cfg.requestTimeoutMs,
    })

    client.onExit(() => {
      this.toolCache.delete(id)
      for (const [k, v] of Array.from(this.toolIndex.entries())) {
        if (v.serverId === id) this.toolIndex.delete(k)
      }
      this.emit('change')
    })

    client.onNotification((method, _params) => {
      if (method === 'notifications/tools/list_changed') {
        this.toolCache.delete(id)
        this.refreshTools(id).catch((err) => console.error('[MCP] tools refresh error:', err))
      }
    })

    this.clients.set(id, client)

    try {
      if (this.disposed) throw new Error('MCP manager is shutting down')
      await client.start()
      // `shutdown()` may have run while the child was spawning: stop it here,
      // otherwise it would outlive the app as an orphan process.
      if (this.disposed) {
        await client.stop().catch(() => {})
        this.clients.delete(id)
        throw new Error('MCP manager is shutting down')
      }
      await this.refreshTools(id)
      this.emit('change')
      return this.toStatus(cfg, client)
    } catch (err) {
      await client.stop().catch(() => {})
      this.clients.delete(id)
      this.emit('change')
      throw new Error(`Failed to start MCP server "${cfg.name}": ${(err as Error).message}`)
    }
  }

  /** Stop one server and forget its cached tools. */
  async stopServer(id: string): Promise<MCPServerStatus> {
    const client = this.clients.get(id)
    if (client) {
      await client.stop()
      this.clients.delete(id)
    }
    this.toolCache.delete(id)
    for (const [k, v] of this.toolIndex.entries()) {
      if (v.serverId === id) this.toolIndex.delete(k)
    }
    this.emit('change')
    const cfg = this.config.get(id)
    if (!cfg) {
      return { id, name: id, enabled: false, running: false, toolCount: 0 }
    }
    return { id, name: cfg.name, enabled: cfg.enabled, running: false, toolCount: 0 }
  }

  /** Stop then start — the "apply my config change" path. */
  async restartServer(id: string): Promise<MCPServerStatus> {
    await this.stopServer(id)
    return this.startServer(id)
  }

  /**
   * Add or replace a server definition.
   *
   * A running server whose command or args changed is restarted, because the old process
   * is running the *old* definition and the panel would otherwise show it as healthy
   * while behaving per the new config.
   */
  async upsertServer(server: MCPServerConfig): Promise<MCPServerStatus> {
    this.config.upsert(server)
    const wasRunning = this.clients.get(server.id)?.isRunning() ?? false
    if (wasRunning) {
      await this.restartServer(server.id)
    } else {
      this.emit('change')
    }
    return this.getStatus(server.id)
  }

  /** Stop and forget a server; returns whether it existed. */
  async removeServer(id: string): Promise<boolean> {
    await this.stopServer(id)
    const removed = this.config.remove(id)
    if (removed) this.emit('change')
    return removed
  }

  /** Enable/disable a server, starting or stopping it to match. */
  async setServerEnabled(id: string, enabled: boolean): Promise<MCPServerStatus> {
    const had = this.config.get(id)
    if (!had) throw new Error(`MCP server "${id}" not found`)
    this.config.setEnabled(id, enabled)
    if (!enabled) {
      await this.stopServer(id)
    } else {
      await this.startServer(id)
    }
    return this.getStatus(id)
  }

  /** One server's current state, including a placeholder entry for unknown ids. */
  getStatus(id: string): MCPServerStatus {
    const cfg = this.config.get(id)
    if (!cfg) return { id, name: id, enabled: false, running: false, toolCount: 0, error: 'not found' }
    const client = this.clients.get(id)
    const tools = this.toolCache.get(id) ?? []
    return {
      id,
      name: cfg.name,
      enabled: cfg.enabled,
      running: client?.isRunning() ?? false,
      toolCount: tools.length,
      error: client && !client.isRunning() ? 'not running' : undefined,
      serverInfo: client?.getServerInfo()
        ? { name: client.getServerInfo()!.serverInfo.name, version: client.getServerInfo()!.serverInfo.version }
        : undefined,
    }
  }

  /**
   * Every tool from every running server, each tagged with its server.
   *
   * A server that fails to answer is skipped rather than aborting the whole list: a
   * broken server should cost the user that server's tools, not all of them.
   */
  async getAllTools(): Promise<MCPToolWithServer[]> {
    const all: MCPToolWithServer[] = []
    for (const id of this.clients.keys()) {
      let tools = this.toolCache.get(id)
      if (!tools) {
        try {
          tools = await this.refreshTools(id)
        } catch (err) {
          console.error(`[MCP] refresh tools failed for "${id}":`, err)
          continue
        }
      }
      all.push(...tools)
    }
    return all
  }

  /**
   * Invoke a tool by its `mcp__<server>__<tool>` id, starting the server if needed.
   *
   * The lookup goes through the cached index so the id never has to be split and guessed
   * at; a cache miss triggers a refresh before giving up, because a server that started
   * after the last refresh would otherwise look like it has no such tool.
   */
  async callTool(fullName: string, args: Record<string, unknown>): Promise<unknown> {
    const indexEntry = this.toolIndex.get(fullName)
    let serverId: string | undefined = indexEntry?.serverId
    let toolName: string | undefined = indexEntry?.toolName

    if (!serverId) {
      const tools = await this.getAllTools()
      const found = tools.find((t) => t.fullName === fullName)
      if (!found) throw new Error(`MCP tool "${fullName}" not found`)
      serverId = found.serverId
      toolName = found.name
    }

    const client = this.clients.get(serverId)
    if (!client) throw new Error(`MCP server for "${fullName}" is not running`)
    if (!client.isRunning()) {
      try {
        await this.startServer(serverId)
      } catch (err) {
        throw new Error(`Failed to start MCP server: ${(err as Error).message}`)
      }
    }

    const result = await client.callTool(toolName!, args ?? {})

    if (result.isError) {
      const text = result.content.find((c) => c.type === 'text') as { type: 'text'; text: string } | undefined
      throw new Error(text?.text ?? 'MCP tool returned an error')
    }

    const textBlocks = result.content.filter((c): c is { type: 'text'; text: string } => c.type === 'text')
    if (textBlocks.length === 1) return textBlocks[0].text
    if (textBlocks.length > 1) return textBlocks.map((b) => b.text).join('\n')
    return result.content
  }

  /** Transport- and protocol-level counters for the diagnostics panel. */
  getDiagnostics(id: string) {
    return this.clients.get(id)?.getDiagnostics()
  }

  /** Re-read one server's tool list and rebuild the `mcp__…` index for it. */
  private async refreshTools(id: string): Promise<MCPToolWithServer[]> {
    const client = this.clients.get(id)
    if (!client || !client.isRunning()) return []
    const cfg = this.config.get(id)
    if (!cfg) return []
    const { tools } = await client.listTools()
    const withServer: MCPToolWithServer[] = tools.map((t) => ({
      ...t,
      serverId: id,
      serverName: cfg.name,
      fullName: `mcp__${this.sanitize(cfg.name)}__${this.sanitize(t.name)}`,
    }))
    this.toolCache.set(id, withServer)
    for (const [k, v] of this.toolIndex.entries()) {
      if (v.serverId === id) this.toolIndex.delete(k)
    }
    for (const t of withServer) {
      this.toolIndex.set(t.fullName, { serverId: t.serverId, toolName: t.name })
    }
    return withServer
  }

  /** `[^A-Za-z0-9_-] -> _`, so a tool id is always a safe identifier. */
  private sanitize(s: string): string {
    return s.replace(/[^a-zA-Z0-9_-]/g, '_')
  }

  /** Merge a stored config with the live client state into one status object. */
  private toStatus(cfg: MCPServerConfig, client: MCPClient): MCPServerStatus {
    const tools = this.toolCache.get(cfg.id) ?? []
    return {
      id: cfg.id,
      name: cfg.name,
      enabled: cfg.enabled,
      running: client.isRunning(),
      toolCount: tools.length,
      serverInfo: client.getServerInfo()
        ? { name: client.getServerInfo()!.serverInfo.name, version: client.getServerInfo()!.serverInfo.version }
        : undefined,
    }
  }
}
