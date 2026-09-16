import { ipcMain, BrowserWindow } from 'electron'
import { MCPManager } from '../services/mcp/manager'
import { MCPServerConfig } from '../services/mcp/config'

export function registerMCPHandlers(getWindow: () => BrowserWindow | null, manager: MCPManager) {
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
}
