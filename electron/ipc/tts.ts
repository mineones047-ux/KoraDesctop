import { ipcMain } from 'electron'
import { TTSService } from '../services/tts'

/**
 * Text → audio. The renderer gets base64 rather than a Buffer because IPC only
 * structured-clones JSON-safe values, and a hand-rolled decode avoids a second
 * dependency in the browser bundle.
 */
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