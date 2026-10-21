/**
 * Local AI IPC (`localai:*`): HF search/download, the downloaded-models
 * manifest, the llama.cpp engine and the llama-server lifecycle.
 *
 * Everything long-running pushes `localai:progress` events to the window so
 * the renderer can render bars without polling; handlers resolve with plain
 * `{ success, error }` objects instead of rejections (the UI shows strings).
 */
import { ipcMain, BrowserWindow } from 'electron'
import { execFile } from 'child_process'
import os from 'os'
import * as hf from '../services/hf'
import * as engine from '../services/llama-engine'
import { parseVramSmi, pickBestFile, recommendFor, type PcProfile, type Recommendation } from '../services/local-llm'
import { config } from '../services/config'

/** Payload of the `localai:progress` channel; `kind` says what moved. */
export interface LocalAIProgress {
  kind: 'model' | 'engine' | 'server'
  /** `repoId/file` for model jobs. */
  key?: string
  repoId?: string
  file?: string
  received?: number
  total?: number
  state: 'running' | 'done' | 'error' | 'canceled' | 'stopped'
  error?: string
  model?: unknown
  exitCode?: number | null
}

/** Best-effort VRAM probe: nvidia-smi answers on NVIDIA boxes, else null. */
function probeVram(): Promise<number | null> {
  return new Promise((resolve) => {
    execFile(
      'nvidia-smi',
      ['--query-gpu=memory.total', '--format=csv,noheader,nounits'],
      { timeout: 2500, windowsHide: true },
      (err, stdout) => resolve(err ? null : parseVramSmi(stdout)),
    )
  })
}

async function probeProfile(): Promise<{ profile: PcProfile; recommendation: Recommendation }> {
  const ramGb = Math.round((os.totalmem() / 2 ** 30) * 10) / 10
  const profile: PcProfile = { ramGb, cpuCores: os.cpus().length, vramGb: await probeVram() }
  return { profile, recommendation: recommendFor(profile) }
}

/** RAM/VRAM do not change mid-session — probe once, reuse for every files call. */
let profileCache: Promise<{ profile: PcProfile; recommendation: Recommendation }> | null = null
function probeProfileCached(): Promise<{ profile: PcProfile; recommendation: Recommendation }> {
  return (profileCache ??= probeProfile())
}

/** Port of the configured llama.cpp endpoint (default 8080). */
function configuredPort(): number {
  try {
    const url = new URL(config.get().llamacppUrl || 'http://localhost:8080')
    const port = Number(url.port || '8080')
    return isFinite(port) && port > 0 ? port : 8080
  } catch {
    return 8080
  }
}

export function registerLocalAIHandlers(getWindow: () => BrowserWindow | null): void {
  const send = (progress: LocalAIProgress): void => {
    const win = getWindow()
    if (win && !win.isDestroyed()) win.webContents.send('localai:progress', progress)
  }

  engine.setServerExitListener((code) => {
    // A server that died on its own must not leave the UI claiming "running".
    send({ kind: 'server', state: code === 0 ? 'stopped' : 'error', exitCode: code })
  })

  ipcMain.handle('localai:profile', () => probeProfileCached())

  ipcMain.handle('localai:search', async (_event, query: string) => {
    try {
      return { success: true, models: await hf.searchModels(String(query ?? '')) }
    } catch (err) {
      return { success: false, error: (err as Error).message, models: [] }
    }
  })

  ipcMain.handle('localai:files', async (_event, repoId: string) => {
    try {
      const files = await hf.listGgufFiles(String(repoId ?? ''))
      // Rank for THIS machine so the UI can badge the file we would pick.
      const { profile } = await probeProfileCached()
      const best = pickBestFile(files, profile)
      return { success: true, files: files.map((f) => ({ ...f, recommended: best?.path === f.path })) }
    } catch (err) {
      return { success: false, error: (err as Error).message, files: [] }
    }
  })

  ipcMain.handle('localai:download', async (_event, repoId: string, file: string) => {
    try {
      const model = await hf.downloadModel(String(repoId), String(file), (progress) =>
        send({ kind: 'model', ...progress }),
      )
      return { success: true, model }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  ipcMain.handle('localai:cancel', (_event, repoId: string, file: string) => {
    hf.cancelDownload(String(repoId), String(file))
    return { success: true }
  })

  ipcMain.handle('localai:list', async () => ({ success: true, models: await hf.listDownloaded() }))

  ipcMain.handle('localai:remove', async (_event, repoId: string, file: string) => {
    try {
      await hf.removeModel(String(repoId), String(file))
      return { success: true }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  ipcMain.handle('localai:engineStatus', async () => ({ success: true, status: await engine.engineStatus() }))

  ipcMain.handle('localai:downloadEngine', async () => {
    try {
      const binaryPath = await engine.downloadEngine((received, total) =>
        send({ kind: 'engine', received, total, state: 'running' }),
      )
      send({ kind: 'engine', state: 'done' })
      return { success: true, binaryPath }
    } catch (err) {
      send({ kind: 'engine', state: 'error', error: (err as Error).message })
      return { success: false, error: (err as Error).message }
    }
  })

  ipcMain.handle('localai:start', async (_event, repoId: string, file: string) => {
    try {
      const manifest = await hf.readManifest()
      const entry = manifest.find((m) => m.repoId === repoId && m.file === file)
      if (!entry) return { success: false, error: 'Model not found in the manifest' }
      const result = await engine.startServer(entry.path, configuredPort())
      // Point the chat at the freshly served model so it is usable immediately.
      config.set('provider', 'llamacpp')
      if (result.modelId) config.set('selectedModel', result.modelId)
      return { success: true, modelId: result.modelId, external: result.external, port: result.port }
    } catch (err) {
      const message = (err as Error).message ?? String(err)
      return { success: false, error: message === 'ENGINE_MISSING' ? 'ENGINE_MISSING' : message }
    }
  })

  ipcMain.handle('localai:stop', async () => {
    try {
      const result = await engine.stopServer()
      return { success: true, ...result }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })
}
