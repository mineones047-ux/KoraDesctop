import { ipcMain, BrowserWindow } from 'electron'
import { MCPManager } from '../services/mcp/manager'
import { MCPServerConfig, launchSpecForPackage } from '../services/mcp/config'

/**
 * IPC surface of the MCP manager, consumed by the settings UI and the agent.
 *
 * Takes the manager and a window getter rather than importing singletons, so tests can
 * drive it with a fake manager and a fake window.
 *
 * Manager errors are returned as `{success: false, error}` throughout: a server that
 * refuses to start is an expected state the settings panel renders, not an exception to
 * propagate across IPC.
 */
export function registerMCPHandlers(getWindow: () => BrowserWindow | null, manager: MCPManager) {
  // Any change to server list/status is pushed to the renderer so the settings panel
  // stays in sync even when the change came from outside (auto-start, crash, crash-restart).
  const broadcast = () => {
    const w = getWindow()
    if (w && !w.isDestroyed()) {
      w.webContents.send('mcp:changed', manager.listServers())
    }
  }
  manager.on('change', broadcast)

  ipcMain.handle('mcp:list', () => manager.listServers())

  ipcMain.handle('mcp:getConfig', (_event, id: string) => manager.getServerConfig(id))

  ipcMain.handle('mcp:listTools', async (_event, serverId?: string) => {
    if (serverId) {
      const status = manager.getStatus(serverId)
      if (!status.running) {
        try {
          await manager.startServer(serverId)
        } catch (err) {
          return { error: (err as Error).message, tools: [] }
        }
      }
      const all = await manager.getAllTools()
      return { tools: all.filter((t) => t.serverId === serverId) }
    }
    const tools = await manager.getAllTools()
    return { tools }
  })

  ipcMain.handle('mcp:start', async (_event, id: string) => {
    try {
      const status = await manager.startServer(id)
      return { success: true, status }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  ipcMain.handle('mcp:stop', async (_event, id: string) => {
    try {
      const status = await manager.stopServer(id)
      return { success: true, status }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  ipcMain.handle('mcp:restart', async (_event, id: string) => {
    try {
      const status = await manager.restartServer(id)
      return { success: true, status }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  ipcMain.handle('mcp:upsert', async (_event, server: MCPServerConfig) => {
    try {
      const status = await manager.upsertServer(server)
      return { success: true, status }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  ipcMain.handle('mcp:remove', async (_event, id: string) => {
    try {
      const removed = await manager.removeServer(id)
      return { success: removed }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  ipcMain.handle('mcp:setEnabled', async (_event, id: string, enabled: boolean) => {
    try {
      const status = await manager.setServerEnabled(id, enabled)
      return { success: true, status }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  ipcMain.handle('mcp:call', async (_event, fullName: string, args: Record<string, unknown>) => {
    try {
      const result = await manager.callTool(fullName, args ?? {})
      return { success: true, result }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  ipcMain.handle('mcp:diagnostics', (_event, id: string) => manager.getDiagnostics(id) ?? null)

  /**
   * Install an MCP server from an npm package and start it.
   *
   * The agent can reach this through the `mcp_manage` tool, so the package
   * name is validated hard: it must look like an npm package (optionally
   * scoped), because it ends up as an argument to npx. Environment variables
   * are accepted for credentials, but the ones that would change how the child
   * process is launched (PATH, NODE_OPTIONS, …) are dropped — the agent could
   * otherwise point the server at its own code.
   */
  ipcMain.handle(
    'mcp:install',
    async (
      _event,
      spec: {
        package?: string
        id?: string
        name?: string
        args?: string[]
        env?: Record<string, string>
        autoStart?: boolean
      },
    ) => {
      try {
        const pkg = String(spec?.package ?? '').trim()
        if (!/^(@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/i.test(pkg)) {
          return { success: false, error: 'Invalid npm package name' }
        }
        const extra = Array.isArray(spec?.args)
          ? spec.args.filter((a): a is string => typeof a === 'string').slice(0, 16)
          : []
        const launch = launchSpecForPackage(pkg, extra)
        const blocked = new Set(['PATH', 'NODE_OPTIONS', 'LD_PRELOAD', 'LD_LIBRARY_PATH', 'ELECTRON_RUN_AS_NODE'])
        const env: Record<string, string> = {}
        for (const [k, v] of Object.entries(spec?.env ?? {})) {
          if (typeof v !== 'string' || blocked.has(k.toUpperCase())) continue
          env[k] = v
        }
        const id = String(spec?.id ?? pkg)
          .replace(/[^a-zA-Z0-9_-]+/g, '-')
          .replace(/^-+|-+$/g, '')
          .slice(0, 64) || 'mcp-server'
        const server: MCPServerConfig = {
          id,
          name: String(spec?.name ?? pkg).slice(0, 80),
          command: launch.command,
          args: launch.args,
          env: Object.keys(env).length > 0 ? { ...launch.env, ...env } : launch.env,
          enabled: true,
          autoStart: spec?.autoStart !== false,
          description: `Installed from npm: ${pkg}`,
        }
        await manager.upsertServer(server)
        const status = await manager.startServer(id)
        const tools = await manager.getAllTools()
        return { success: true, status, tools: tools.filter((t) => t.serverId === id) }
      } catch (err) {
        return { success: false, error: (err as Error).message }
      }
    },
  )
}
