import { ipcMain, clipboard } from 'electron'

export function registerClipboardHandlers() {
  ipcMain.handle('clipboard:read', async () => {
    return clipboard.readText()
  })

  ipcMain.handle('clipboard:write', async (_event, text: string) => {
    clipboard.writeText(text)
    return { success: true }
  })
}
