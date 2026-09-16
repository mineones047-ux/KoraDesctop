import { ipcMain } from 'electron'
import { TTSService } from '../services/tts'

export function registerTTSHandlers() {
  ipcMain.handle('tts:synthesize', async (_event, text: string, voice?: string) => {
    try {
      const buffer = await TTSService.synthesize(text, voice)
      return { success: true, audio: buffer.toString('base64') }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle('tts:voices', async () => {
    return TTSService.getVoices()
  })
}