import { app, BrowserWindow, ipcMain, screen, shell } from 'electron'
import path from 'path'
import { registerSystemHandlers } from './ipc/system'
import { registerFileHandlers } from './ipc/filesystem'
import { registerShellHandlers } from './ipc/shell'
import { registerChatHandlers } from './ipc/chats'
import { registerClipboardHandlers } from './ipc/clipboard'
import { registerWebHandlers } from './ipc/web'
import { registerAIHandlers } from './ipc/ai'
import { registerTTSHandlers } from './ipc/tts'
import { registerMCPHandlers } from './ipc/mcp'
import { registerObsidianHandlers } from './ipc/obsidian'
import { config, registerConfigHandlers } from './services/config'
import { MCPConfig } from './services/mcp/config'
import { MCPManager } from './services/mcp/manager'

let mainWindow: BrowserWindow | null = null
let isQuitting = false

process.on('uncaughtException', (err) => {
  console.error('[KORA] Uncaught exception:', err)
})

process.on('unhandledRejection', (reason) => {
  console.error('[KORA] Unhandled rejection:', reason)
})

function createWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize

  mainWindow = new BrowserWindow({
    width: Math.min(1200, width),
    height: Math.min(800, height),
    minWidth: 800,
    minHeight: 600,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#0a0a0a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
    show: false,
  })

  const devServerUrl = process.env.VITE_DEV_SERVER_URL
  if (devServerUrl) {
    mainWindow.loadURL(devServerUrl)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  const isAllowedUrl = (url: string): boolean => {
    try {
      const parsed = new URL(url)
      if (devServerUrl) {
        // Exact host:port match — startsWith would let http://localhost:5173.evil.com through
        try {
          const dev = new URL(devServerUrl)
          return parsed.protocol === 'http:' && parsed.host === dev.host
        } catch {
          return false
        }
      }
      const indexPath = path.join(__dirname, '../dist/index.html')
      return parsed.protocol === 'file:' && path.resolve(parsed.pathname.replace(/^\/([A-Za-z]:)/, '$1')) === path.resolve(indexPath)
    } catch {
      return false
    }
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (isAllowedUrl(url)) return
    event.preventDefault()
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url)
    }
  })

  mainWindow.webContents.on('will-attach-webview', (event) => {
    event.preventDefault()
  })

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.webContents.on('render-process-gone', (_event: any, details: any) => {
    console.error('[KORA] Renderer crashed:', details.reason, details.exitCode)
  })

  mainWindow.webContents.on('did-fail-load', (_e, code, desc) => {
    console.error('[KORA] Failed to load:', code, desc)
  })

  mainWindow.webContents.on('console-message', (_e, level, msg, line, sourceId) => {
    if (level >= 2) {
      console.error(`[KORA][RENDERER] ${msg} (${sourceId}:${line})`)
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  mainWindow.on('maximize', () => {
    mainWindow?.webContents.send('window:maximized', true)
  })
  mainWindow.on('unmaximize', () => {
    mainWindow?.webContents.send('window:maximized', false)
  })
}

// GPU acceleration stays enabled on compatible systems. The development launcher
// retries once with this flag after a known GPU-process crash.
if (process.env.KORA_DISABLE_GPU === '1' || app.commandLine.hasSwitch('disable-gpu')) {
  app.disableHardwareAcceleration()
}

app.whenReady().then(async () => {
  try {
    await config.load()
    registerConfigHandlers()
    registerSystemHandlers()
    registerFileHandlers()
    registerShellHandlers()
    registerChatHandlers()
    registerClipboardHandlers()
    registerWebHandlers()

    const mcpConfig = new MCPConfig()
    const mcpManager = new MCPManager(mcpConfig)
    try {
      await mcpManager.init()
    } catch (err) {
      console.error('[KORA] MCP init error:', err)
    }

    ipcMain.on('window:minimize', () => mainWindow?.minimize())
    ipcMain.on('window:maximize', () => {
      if (mainWindow?.isMaximized()) {
        mainWindow.unmaximize()
      } else {
        mainWindow?.maximize()
      }
    })
    ipcMain.on('window:close', () => mainWindow?.close())
    ipcMain.on('window:isMaximized', (e) => {
      e.returnValue = mainWindow?.isMaximized() ?? false
    })

    createWindow()

    registerAIHandlers(() => mainWindow)
    registerTTSHandlers()
    registerMCPHandlers(() => mainWindow, mcpManager)
    registerObsidianHandlers()

    app.on('before-quit', async (e) => {
      if (isQuitting || !mcpManager) return
      e.preventDefault()
      isQuitting = true
      try {
        await mcpManager.shutdown()
      } catch (err) {
        console.error('[KORA] MCP shutdown error:', err)
      }
      app.quit()
    })
  } catch (err) {
    console.error('[KORA] Failed to start:', err)
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow()
  }
})