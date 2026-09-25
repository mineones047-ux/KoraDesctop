/**
 * LLM IPC handlers (ai:*): chat, chatStream, listModels, testConnection.
 *
 * chatStream creates a one-shot reply channel plus a `<channel>:ctl` control
 * channel so the renderer can abort with '[ABORT]'; '[DONE]' is always sent in
 * the finally block. Local providers (LM Studio/Ollama) are routed through
 * LMStudioClient, everything else through APIClient (services/api.ts).
 */
import { ipcMain, BrowserWindow } from 'electron'
import { APIClient } from '../services/api'
import { LMStudioClient } from '../services/lmstudio'
import { config } from '../services/config'

export function registerAIHandlers(getWindow: () => BrowserWindow | null) {
  const win = (): BrowserWindow | null => getWindow()
  ipcMain.handle('ai:chat', async (_event, messages, options) => {
    if (options.provider === 'lmstudio' || options.provider === 'ollama') {
      return LMStudioClient.chat(messages, options.baseUrl, options.temperature, options.jsonMode)
    }
    return APIClient.chat(messages, options.apiKey, options.baseUrl, options.model, options.provider, options.temperature, options.jsonMode)
  })

  ipcMain.on('ai:chatStream', async (event, messages, options, channel) => {
    const ctlChannel = `${channel}:ctl`
    const send = (payload: string) => {
      const w = win()
      if (w && !w.isDestroyed()) {
        w.webContents.send(channel, payload)
      }
    }
    const sendCtl = (payload: string) => {
      const w = win()
      if (w && !w.isDestroyed()) {
        w.webContents.send(ctlChannel, payload)
      }
    }

    // Abort support: renderer sends '[ABORT]' on the control channel
    const controller = new AbortController()
    const onCtl = (_e: unknown, payload: string) => {
      if (payload === '[ABORT]') controller.abort()
    }
    ipcMain.on(ctlChannel, onCtl)

    try {
      if (options.provider === 'lmstudio' || options.provider === 'ollama') {
        await LMStudioClient.chatStream(messages, send, options.baseUrl, options.temperature, controller.signal, options.jsonMode)
      } else {
        await APIClient.chatStream(messages, send, options.apiKey, options.baseUrl, options.model, options.provider, options.temperature, controller.signal, options.jsonMode)
      }
    } catch (error) {
      // Aborted by user — end silently, partial content is already delivered
      if (!controller.signal.aborted) {
        sendCtl(`[ERROR] ${(error as Error).message}`)
      }
    } finally {
      ipcMain.removeListener(ctlChannel, onCtl)
      sendCtl('[DONE]')
    }
  })

  ipcMain.handle('ai:listModels', async (_event, provider, baseUrl, apiKey) => {
    if (provider === 'lmstudio' || provider === 'ollama') {
      return LMStudioClient.listModels(baseUrl)
    }
    return APIClient.listModels(baseUrl || '', apiKey || '', provider)
  })

  ipcMain.handle('ai:testConnection', async (_event, options) => {
    try {
      if (options.provider === 'lmstudio' || options.provider === 'ollama') {
        return await LMStudioClient.testConnection(options.baseUrl)
      }
      return await APIClient.testConnection(options.apiKey || '', options.baseUrl || '', options.provider)
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })
}