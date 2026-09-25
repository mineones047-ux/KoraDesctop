/**
 * whisper.cpp IPC handler (ROADMAP Phase 0: local STT).
 *
 * The renderer records mic audio, converts it to 16 kHz mono WAV and sends
 * base64 here; we write a temp file and run the user-configured `whisper-cli`
 * with fixed, non-shell arguments. Nothing here is reachable from the network;
 * the binary/model paths are user settings (same trust level as MCP commands).
 */
import { ipcMain } from 'electron'
import { spawn } from 'child_process'
import fs from 'fs/promises'
import path from 'path'
import os from 'os'
import crypto from 'crypto'
import { config } from '../services/config'

const MAX_AUDIO_BYTES = 25 * 1024 * 1024 // ~25 MB ~ 13 min of 16 kHz mono PCM
const TRANSCRIBE_TIMEOUT_MS = 120_000

function transcribe(
  whisperPath: string,
  modelPath: string,
  wavPath: string,
  language: string,
): Promise<{ success: boolean; text?: string; error?: string }> {
  return new Promise((resolve) => {
    const child = spawn(
      whisperPath,
      ['-m', modelPath, '-f', wavPath, '-l', language, '-nt', '-np'],
      { windowsHide: true, shell: false },
    )

    let stdout = ''
    let stderr = ''
    let settled = false

    const finish = (result: { success: boolean; text?: string; error?: string }) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result)
    }

    const timer = setTimeout(() => {
      try {
        child.kill()
      } catch {
        // already dead
      }
      finish({ success: false, error: `whisper.cpp timed out after ${TRANSCRIBE_TIMEOUT_MS / 1000}s` })
    }, TRANSCRIBE_TIMEOUT_MS)

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf-8')
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf-8')
      if (stderr.length > 8192) stderr = stderr.slice(-8192)
    })

    child.on('error', (err) => {
      finish({ success: false, error: `Failed to start whisper.cpp: ${err.message}` })
    })

    child.on('close', (code) => {
      if (code !== 0) {
        finish({
          success: false,
          error: `whisper.cpp exited with code ${code}: ${stderr.trim().slice(0, 300) || 'no stderr output'}`,
        })
        return
      }
      // whisper-cli prints the transcript on stdout; -nt removes timestamps,
      // but old builds may still prefix them - strip defensively.
      const text = stdout
        .split(/\r?\n/)
        .map((line) => line.replace(/^\[[\d:.,\s>-]+\]\s*/, '').trim())
        .filter(Boolean)
        .join(' ')
        .trim()
      finish(
        text
          ? { success: true, text }
          : { success: false, error: 'whisper.cpp returned an empty transcript' },
      )
    })
  })
}

export function registerSTTHandlers() {
  ipcMain.handle('stt:transcribe', async (_event, audioBase64: string, language?: string) => {
    try {
      const cfg = config.get()
      if (cfg.sttEngine !== 'whisper') {
        return { success: false, error: 'whisper.cpp STT is not enabled in settings' }
      }
      const whisperPath = typeof cfg.whisperPath === 'string' ? cfg.whisperPath.trim() : ''
      const modelPath = typeof cfg.whisperModel === 'string' ? cfg.whisperModel.trim() : ''
      if (!whisperPath || !modelPath) {
        return { success: false, error: 'Set the whisper.cpp binary and model paths in Settings -> Voice' }
      }

      if (typeof audioBase64 !== 'string' || !audioBase64) {
        return { success: false, error: 'No audio received' }
      }
      const audio = Buffer.from(audioBase64, 'base64')
      if (audio.length === 0) return { success: false, error: 'Empty audio payload' }
      if (audio.length > MAX_AUDIO_BYTES) {
        return { success: false, error: 'Recording is too long - keep voice input under ~10 minutes' }
      }
      if (audio.subarray(0, 4).toString('ascii') !== 'RIFF') {
        return { success: false, error: 'Unsupported audio payload (expected WAV)' }
      }

      await fs.access(whisperPath)
      await fs.access(modelPath)

      const wavPath = path.join(os.tmpdir(), 'kora-stt-' + crypto.randomBytes(6).toString('hex') + '.wav')
      await fs.writeFile(wavPath, audio)

      try {
        const lang =
          typeof language === 'string' && /^[a-z]{2}(-[A-Za-z]{2,4})?$/.test(language) ? language : 'auto'
        return await transcribe(whisperPath, modelPath, wavPath, lang)
      } finally {
        fs.unlink(wavPath).catch(() => {})
      }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })
}
