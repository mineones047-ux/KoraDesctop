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
import fs from 'fs'
import path from 'path'
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
  state: 'running' | 'done' | 'error' | 'paused' | 'stopped'
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

/** Engine launch knobs from the saved config (undefined = engine default). */
function launchOptions(): { gpuLayers?: number; ctxSize?: number } {
  const cfg = config.get()
  return {
    gpuLayers: typeof cfg.llamacppGpuLayers === 'number' && cfg.llamacppGpuLayers >= 0 ? cfg.llamacppGpuLayers : undefined,
    ctxSize: typeof cfg.llamacppCtxSize === 'number' ? cfg.llamacppCtxSize : undefined,
  }
}

/**
 * Startup hooks — replaced inside `registerLocalAIHandlers` (the launch work needs
 * this module's closured helpers, and there is no first user call to rely on).
 * Exported so main.ts can fire it once the window exists.
 */
const runStartupTasksImpl: { ready: boolean; run: () => Promise<void> } = {
  ready: false,
  run: async () => {},
}

export function runStartupTasks(): Promise<void> {
  return runStartupTasksImpl.run()
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

  // Curated whisper.cpp models (recognition, STT). Only file names matching the
  // whitelist are accepted, from the official engine repo — a renderer cannot name
  // an arbitrary URL or escape the models directory.
  ipcMain.handle('localai:downloadStt', async (_event, file: string) => {
    const name = String(file ?? '')
    const key = `whisper:${name}`
    try {
      if (!/^ggml-[a-z0-9-]+\.bin$/.test(name)) throw new Error('Unknown whisper model file')
      const target = path.join(hf.MODELS_DIR, 'whisper', name)
      const written = await hf.downloadToFile(
        `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${name}`,
        target,
        {
          signal: new AbortController().signal,
          onBytes: (received, total) =>
            send({ kind: 'model', key, repoId: 'ggerganov/whisper.cpp', file: name, received, total, state: 'running' }),
        },
      )
      send({ kind: 'model', key, received: written, total: written, state: 'done' })
      return { success: true, path: target }
    } catch (err) {
      send({ kind: 'model', key, received: 0, total: 0, state: 'error', error: (err as Error).message })
      return { success: false, error: (err as Error).message }
    }
  })

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

  /**
   * Pause a running download. The bytes already fetched stay on disk as a
   * `.part` file, and the next download of the same file resumes from there
   * instead of starting over.
   */
  ipcMain.handle('localai:pause', (_event, repoId: string, file: string) => {
    hf.cancelDownload(String(repoId), String(file))
    return { success: true }
  })

  /** How much of a paused download is already on disk (0 = nothing to resume). */
  ipcMain.handle('localai:partials', async (_event, repoId: string) => {
    try {
      return { success: true, partials: await hf.listPartials(String(repoId)) }
    } catch (err) {
      return { success: false, partials: [], error: (err as Error).message }
    }
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

  ipcMain.handle('localai:scanDisks', async () => {
    try {
      const roots: string[] = []
      if (process.platform === 'win32') {
        for (let i = 65; i <= 90; i++) {
          const drive = `${String.fromCharCode(i)}:\\`
          try {
            if (fs.existsSync(drive)) roots.push(drive)
          } catch { /* unreadable drive letter */ }
        }
      } else {
        roots.push('/')
      }
      const skip = new Set([
        'windows', 'program files', 'program files (x86)', 'programdata',
        '$recycle.bin', 'system volume information', 'appdata', 'node_modules',
        '.git', 'lost+found', 'proc', 'sys', 'dev', 'boot', 'usr', 'var',
      ])
      const found: { path: string; sizeBytes: number }[] = []
      const deadline = Date.now() + 8000

      async function walk(dir: string, depth: number): Promise<void> {
        if (depth > 3 || found.length >= 60 || Date.now() > deadline) return
        let entries
        try {
          entries = await fs.promises.readdir(dir, { withFileTypes: true })
        } catch {
          return
        }
        for (const entry of entries) {
          if (found.length >= 60 || Date.now() > deadline) return
          const lower = entry.name.toLowerCase()
          const full = path.join(dir, entry.name)
          if (entry.isFile() && lower.endsWith('.gguf')) {
            try {
              const size = (await fs.promises.stat(full)).size
              found.push({ path: full, sizeBytes: size })
            } catch { /* vanished mid-scan */ }
          } else if (entry.isDirectory() && !skip.has(lower) && !lower.startsWith('.')) {
            await walk(full, depth + 1)
          }
        }
      }

      for (const root of roots) await walk(root, 0)
      return { success: true, found }
    } catch (err) {
      return { success: false, found: [], error: (err as Error).message }
    }
  })

  // Start a model that was never downloaded through Kora (found on disk).
  ipcMain.handle('localai:startExternal', async (_event, modelPath: string) => {
    try {
      const resolved = path.resolve(String(modelPath ?? ''))
      if (!resolved.toLowerCase().endsWith('.gguf')) throw new Error('Not a .gguf model file')
      await fs.promises.access(resolved)
      const result = await engine.startServer(resolved, configuredPort(), launchOptions())
      config.set('provider', 'llamacpp')
      if (result.modelId) config.set('selectedModel', result.modelId)
      return { success: true, modelId: result.modelId, external: result.external, port: result.port }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  /**
   * Startup promises (user request): serve the configured chat model and fetch
   * the configured whisper model when it is missing. Best-effort — a failure
   * logs and leaves the app functional.
   */
  async function ensureSttModel(): Promise<void> {
    const cfg = config.get()
    const file = cfg.autoStartSttModel
    if (!file || !/^ggml-[a-z0-9-]+\.bin$/.test(file)) return
    const target = path.join(hf.MODELS_DIR, 'whisper', file)
    if (fs.existsSync(target)) return
    console.log(`[KORA] auto-downloading whisper model ${file}...`)
    await hf.downloadToFile(
      `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${file}`,
      target,
      { signal: new AbortController().signal, onBytes: () => {} },
    )
    if (!cfg.whisperModel) config.set('whisperModel', target)
  }

  async function startChatModel(): Promise<void> {
    const cfg = config.get()
    if (!cfg.autoStartChatModel) return
    const idx = cfg.autoStartChatModel.lastIndexOf('/')
    const repoId = cfg.autoStartChatModel.slice(0, idx)
    const file = cfg.autoStartChatModel.slice(idx + 1)
    const entry = (await hf.readManifest()).find((m) => m.repoId === repoId && m.file === file)
    if (!entry) return
    console.log(`[KORA] auto-loading chat model ${file} on :${configuredPort()}...`)
    try {
      await engine.startServer(entry.path, configuredPort(), launchOptions())
      config.set('provider', 'llamacpp')
    } catch (err) {
      console.error('[KORA] auto-load chat model failed:', (err as Error).message)
    }
  }

  /**
   * Run every launch option once app startup completes. Exported and called from
   * main.ts (not an IPC handler — no renderer may trigger it).
   */
  runStartupTasksImpl.run = async () => {
    try {
      await ensureSttModel()
      await startChatModel()
    } catch (err) {
      console.error('[KORA] local AI startup tasks failed:', (err as Error).message)
    }
  }
  runStartupTasksImpl.ready = true

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
      const result = await engine.startServer(entry.path, configuredPort(), launchOptions())
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
