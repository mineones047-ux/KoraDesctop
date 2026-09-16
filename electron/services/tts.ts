const { MsEdgeTTS } = require('msedge-tts')
import fs from 'fs'
import path from 'path'
import os from 'os'

export const VOICES = {
  'ru-RU-DmitryNeural': 'Дмитрий (русский, мужской)',
  'ru-RU-SvetlanaNeural': 'Светлана (русский, женский)',
  'en-US-GuyNeural': 'Guy (English, male)',
  'en-US-JennyNeural': 'Jenny (English, female)',
  'en-US-AriaNeural': 'Aria (English, female)',
  'de-DE-ConradNeural': 'Conrad (Deutsch)',
  'fr-FR-HenriNeural': 'Henri (Français)',
  'es-ES-ElviraNeural': 'Elvira (Español)',
  'zh-CN-XiaoxiaoNeural': 'Xiaoxiao (中文)',
  'ja-JP-NanamiNeural': 'Nanami (日本語)',
} as const

export type VoiceId = keyof typeof VOICES

const SYNTH_TIMEOUT_MS = 30_000

export class TTSService {
  static async synthesize(text: string, voice: string = 'ru-RU-DmitryNeural'): Promise<Buffer> {
    // Cap input: very long texts produce huge base64 payloads over IPC
    const capped = text.length > 5000 ? text.slice(0, 5000) : text
    const tts = new MsEdgeTTS()
    try {
      await tts.setMetadata(voice, 'audio-24khz-96kbitrate-mono-mp3')

      const tmpDir = path.join(os.tmpdir(), 'kora-tts-' + Date.now())
      fs.mkdirSync(tmpDir, { recursive: true })

      try {
        // The underlying WebSocket has no timeout of its own; a hung Edge
        // service would leave this promise pending forever.
        await Promise.race([
          tts.toFile(tmpDir, capped),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`TTS synthesis timed out after ${SYNTH_TIMEOUT_MS / 1000}s`)), SYNTH_TIMEOUT_MS),
          ),
        ])

        const audioPath = path.join(tmpDir, 'audio.mp3')
        return fs.readFileSync(audioPath)
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true })
      }
    } finally {
      try {
        tts.close()
      } catch {
        // ignore close errors
      }
    }
  }

  static async getVoices(): Promise<{ name: string; label: string }[]> {
    return Object.entries(VOICES).map(([name, label]) => ({ name, label }))
  }
}