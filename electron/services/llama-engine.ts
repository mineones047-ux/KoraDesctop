/**
 * The llama.cpp runtime behind the `llamacpp` provider: find or fetch a
 * `llama-server` binary, then start it on a downloaded GGUF and stop it.
 *
 * Node-only (no Electron imports); ipc/localmodels.ts turns the callbacks into
 * window events. `downloadToFile` is shared with the Hugging Face downloader.
 */
import { spawn, execFile, type ChildProcess } from 'child_process'
import fs from 'fs/promises'
import http from 'http'
import os from 'os'
import path from 'path'
import { downloadToFile } from './hf'
import { pickEngineAsset, type EngineAsset } from './local-llm'

export const ENGINE_DIR = path.join(os.homedir(), '.kora', 'llama.cpp')
const GH_RELEASES = 'https://api.github.com/repos/ggml-org/llama.cpp/releases?per_page=10'
/**
 * Pinned build for when the GitHub API is unreachable (unauthenticated rate
 * limit is 60 req/h and shared IPs blow through it). The asset URL for this
 * tag was verified to exist; release zips are served by a different host than
 * the API, so the download itself keeps working.
 */
const FALLBACK_TAG = 'b11476'
const FALLBACK_SUFFIX: Record<string, string> = {
  'win32-x64': 'bin-win-cpu-x64',
  'darwin-arm64': 'bin-macos-arm64',
  'darwin-x64': 'bin-macos-x64',
  'linux-x64': 'bin-ubuntu-x64',
  'linux-arm64': 'bin-ubuntu-arm64',
}
const START_TIMEOUT_MS = 180_000
const HEALTH_POLL_MS = 700

export interface EngineStatus {
  installed: boolean
  binaryPath: string | null
  running: boolean
  /** True when an external server already owns the port (we neither own nor stop it). */
  external: boolean
  port: number | null
  pid: number | null
  modelPath: string | null
}

/** Managed server child, plus a stderr ring buffer for startup diagnostics. */
let child: ChildProcess | null = null
let currentPort: number | null = null
let currentModel: string | null = null
let externalServer = false
let stderrTail: string[] = []
let onExit: ((code: number | null) => void) | null = null

/** Registered by the IPC layer so the UI learns about unexpected exits. */
export function setServerExitListener(listener: ((code: number | null) => void) | null): void {
  onExit = listener
}

function pushStderr(line: string): void {
  stderrTail.push(line)
  if (stderrTail.length > 40) stderrTail = stderrTail.slice(-40)
}

export function stderrTailLines(): string[] {
  return [...stderrTail]
}

const exeName = (): string => (process.platform === 'win32' ? 'llama-server.exe' : 'llama-server')

/** First `llama-server(.exe)` under the engine dir (zips nest differently per build). */
async function findInEngineDir(dir: string, depth = 0): Promise<string | null> {
  if (depth > 4) return null
  let entries
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return null
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isFile() && entry.name === exeName()) return full
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const found = await findInEngineDir(path.join(dir, entry.name), depth + 1)
      if (found) return found
    }
  }
  return null
}

/** A user-installed binary on PATH is honoured before downloading our own. */
function findOnPath(): Promise<string | null> {
  const command = process.platform === 'win32' ? 'where' : 'which'
  return new Promise((resolve) => {
    execFile(command, [exeName()], { timeout: 3000 }, (err, stdout) => {
      if (err) return resolve(null)
      const first = stdout.split(/\r?\n/).map((l) => l.trim()).find(Boolean)
      resolve(first || null)
    })
  })
}

export async function findServerBinary(): Promise<string | null> {
  return (await findInEngineDir(ENGINE_DIR)) ?? (await findOnPath())
}

/** A GET that classifies a port: closed / answers-503-loading / answers-200. */
function probe(url: string): Promise<{ listening: boolean; ok: boolean }> {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      res.resume()
      const status = res.statusCode ?? 0
      // llama-server answers 503 on /health while the model is still loading
      resolve({ listening: true, ok: status >= 200 && status < 300 || status === 503 })
    })
    req.setTimeout(1500, () => {
      req.destroy()
      resolve({ listening: false, ok: false })
    })
    req.on('error', () => resolve({ listening: false, ok: false }))
  })
}

function probeReady(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      res.resume()
      resolve((res.statusCode ?? 0) === 200)
    })
    req.setTimeout(1500, () => {
      req.destroy()
      resolve(false)
    })
    req.on('error', () => resolve(false))
  })
}

/** The id llama-server reports for the loaded model (what Settings' model list shows). */
function fetchServedModelId(port: number): Promise<string | null> {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}/v1/models`, (res) => {
      let body = ''
      res.on('data', (chunk) => (body += chunk))
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body) as { data?: { id?: string }[] }
          resolve(parsed.data?.[0]?.id ?? null)
        } catch {
          resolve(null)
        }
      })
    })
    req.setTimeout(2000, () => {
      req.destroy()
      resolve(null)
    })
    req.on('error', () => resolve(null))
  })
}

/**
 * Download the official llama.cpp CPU build for this platform into ENGINE_DIR.
 *
 * The releases page is walked newest-first because only some builds carry the
 * plain CPU zip; the CUDA assets are deliberately never chosen (chasing a
 * matching cudart would make a "simple download" fail on half the machines).
 * When the API answers non-200 (rate limit), a pinned release URL is used.
 */
async function releaseAssets(): Promise<EngineAsset[]> {
  try {
    const response = await fetch(GH_RELEASES, {
      headers: { 'user-agent': 'kora-desktop', accept: 'application/vnd.github+json' },
    })
    if (!response.ok) return []
    const releases = (await response.json()) as {
      assets?: { name: string; browser_download_url: string; size: number }[]
    }[]
    return (Array.isArray(releases) ? releases : []).flatMap((release) =>
      (release.assets ?? []).map((a) => ({
        name: a.name,
        url: a.browser_download_url,
        sizeBytes: a.size,
      })),
    )
  } catch {
    return []
  }
}

function fallbackAssets(): EngineAsset[] {
  const suffix = FALLBACK_SUFFIX[`${process.platform}-${process.arch}`]
  if (!suffix) return []
  const name = `llama-${FALLBACK_TAG}-${suffix}.zip`
  return [
    {
      name,
      url: `https://github.com/ggml-org/llama.cpp/releases/download/${FALLBACK_TAG}/${name}`,
      sizeBytes: 19_000_000,
    },
  ]
}

export async function downloadEngine(
  onProgress: (received: number, total: number) => void,
): Promise<string> {
  const asset =
    pickEngineAsset(await releaseAssets(), process.platform, process.arch) ??
    pickEngineAsset(fallbackAssets(), process.platform, process.arch)
  if (!asset) throw new Error('No llama.cpp build found for this platform')

  const zipPath = path.join(os.tmpdir(), `kora-llama-${Date.now()}.zip`)
  try {
    await downloadToFile(asset.url, zipPath, {
      signal: new AbortController().signal,
      onBytes: (received, total) => onProgress(received, total || asset!.sizeBytes),
    })
    // Fresh directory: a previous engine version must not survive half-updated.
    await fs.rm(ENGINE_DIR, { recursive: true, force: true })
    await fs.mkdir(ENGINE_DIR, { recursive: true })
    await new Promise<void>((resolve, reject) => {
      // Windows: System32\tar.exe explicitly — PATH may resolve to a Git-bundled
      // GNU tar, which neither handles `C:\...` archive args nor zip files.
      // Archive passed as a bare name + cwd so no `host:path` misparse either.
      const isWin = process.platform === 'win32'
      const command = isWin
        ? path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')
        : 'unzip'
      const args = isWin
        ? ['-xf', path.basename(zipPath), '-C', ENGINE_DIR]
        : ['-o', '-q', zipPath, '-d', ENGINE_DIR]
      const unzip = spawn(command, args, {
        windowsHide: true,
        cwd: isWin ? path.dirname(zipPath) : undefined,
      })
      let err = ''
      unzip.stderr.on('data', (d) => (err += String(d)))
      unzip.on('error', (e) => reject(e))
      unzip.on('close', (code) =>
        code === 0 ? resolve() : reject(new Error(`extract exited ${code}: ${err.slice(0, 300)}`)),
      )
    })
  } finally {
    await fs.rm(zipPath, { force: true })
  }
  const binary = await findInEngineDir(ENGINE_DIR)
  if (!binary) throw new Error('Engine extracted but llama-server was not found')
  return binary
}

export async function engineStatus(): Promise<EngineStatus> {
  const binaryPath = await findServerBinary()
  const running = !!child && child.exitCode === null
  return {
    installed: binaryPath !== null,
    binaryPath,
    running,
    external: externalServer,
    port: currentPort,
    pid: child?.pid ?? null,
    modelPath: currentModel,
  }
}

export interface StartResult {
  modelId: string | null
  port: number
  external: boolean
}

/** Optional llama-server launch knobs (from the user's saved config). */
export interface StartOptions {
  /** Layers to offload to the GPU (`--n-gpu-layers`); -1 / undefined = engine default. */
  gpuLayers?: number
  /** Context window (`-c`); undefined = 4096. */
  ctxSize?: number
}

/**
 * Serve `modelPath` on `port`.
 *
 * If something already answers there with an OpenAI-compatible `/v1/models`,
 * it is an (external) llama-server we simply reuse — spawning a second one
 * would just lose the port race. Otherwise our own child is started and the
 * wait is bounded: 180 s covers a cold 14B load from an SSD.
 */
export async function startServer(modelPath: string, port: number, opts: StartOptions = {}): Promise<StartResult> {
  // Restart cleanly when a managed server from a previous click is alive.
  if (child && child.exitCode === null) await stopServer()

  const externalId = await fetchServedModelId(port)
  if (externalId) {
    externalServer = true
    currentPort = port
    currentModel = modelPath
    return { modelId: externalId, port, external: true }
  }
  const probed = await probe(`http://127.0.0.1:${port}/health`)
  if (probed.listening) {
    throw new Error(`Port ${port} is occupied by another program`)
  }

  const binary = await findServerBinary()
  if (!binary) throw new Error('ENGINE_MISSING')

  stderrTail = []
  currentModel = modelPath
  currentPort = port
  externalServer = false
  // A readable id in Settings' model list instead of the raw file path.
  const alias = path.basename(modelPath).replace(/\.gguf$/i, '')
  const args = ['-m', modelPath, '--alias', alias, '--host', '127.0.0.1', '--port', String(port)]
  // GPU offload: llama can't see our intent — an explicit 0 pins the model to CPU.
  const gpu = typeof opts.gpuLayers === 'number' && opts.gpuLayers >= 0 ? opts.gpuLayers : null
  if (gpu !== null) args.push('-ngl', String(gpu))
  args.push('-c', String(opts.ctxSize ?? 4096))
  const proc = spawn(binary, args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] })
  child = proc
  proc.stderr?.on('data', (data: Buffer) => {
    for (const line of data.toString('utf-8').split(/\r?\n/)) if (line.trim()) pushStderr(line)
  })
  proc.on('error', (err) => pushStderr(`spawn error: ${err.message}`))
  proc.on('exit', (code) => {
    if (child === proc) {
      child = null
      currentPort = null
      currentModel = null
      externalServer = false
    }
    onExit?.(code)
  })

  const deadline = Date.now() + START_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (proc.exitCode !== null) {
      const tail = stderrTailLines().slice(-6).join(' | ')
      throw new Error(`llama-server exited with code ${proc.exitCode}${tail ? `: ${tail}` : ''}`)
    }
    if (await probeReady(`http://127.0.0.1:${port}/health`)) {
      const modelId = await fetchServedModelId(port)
      return { modelId, port, external: false }
    }
    await new Promise((resolve) => setTimeout(resolve, HEALTH_POLL_MS))
  }
  await stopServer()
  throw new Error('llama-server did not become ready in time')
}

/** Stop the managed server; an external one is reported, never killed. */
export async function stopServer(): Promise<{ stopped: boolean; external: boolean }> {
  if (externalServer || (!child && currentPort === null)) {
    const wasExternal = externalServer
    externalServer = false
    currentPort = null
    currentModel = null
    return { stopped: false, external: wasExternal }
  }
  const proc = child
  child = null
  currentPort = null
  currentModel = null
  if (proc && proc.exitCode === null) {
    const pid = proc.pid
    await new Promise<void>((resolve) => {
      if (process.platform === 'win32' && pid) {
        // The server keeps console children; kill the whole tree.
        const killer = spawn('taskkill', ['/pid', String(pid), '/t', '/f'], { windowsHide: true })
        killer.on('close', () => resolve())
        killer.on('error', () => resolve())
      } else {
        proc.kill('SIGTERM')
        resolve()
      }
      setTimeout(resolve, 3000)
    })
  }
  return { stopped: true, external: false }
}
