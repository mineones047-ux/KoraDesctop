/**
 * Hugging Face model manager: search GGUF repos, list their files, download
 * them into `~/.kora/models/` with progress + cancel, and keep a manifest so
 * downloads survive restarts.
 *
 * Node-only (no Electron imports) — the IPC layer (ipc/localmodels.ts) owns the
 * window events, this file owns the network and the disk.
 */
import fs from 'fs/promises'
import path from 'path'
import os from 'os'
import type { DownloadedModel, HfGgufFile, HfModelEntry } from './local-llm'
import { expandShards, hfDownloadUrl, hfSearchUrl, hfTreeUrl, parseHfSearch, parseHfTree, safeModelTarget } from './local-llm'

export const MODELS_DIR = path.join(os.homedir(), '.kora', 'models')
const MANIFEST_PATH = path.join(MODELS_DIR, 'models.json')

export interface DownloadProgress {
  key: string
  repoId: string
  file: string
  /** Bytes written so far across every part of this job. */
  received: number
  /** Total bytes when known, else 0. */
  total: number
  state: 'running' | 'done' | 'error' | 'canceled'
  error?: string
  /** Manifest row, present on 'done'. */
  model?: DownloadedModel
}

/** Active jobs by `repoId/file`, so cancel can abort exactly one download. */
const activeJobs = new Map<string, AbortController>()

export function downloadKey(repoId: string, file: string): string {
  return `${repoId}/${file}`
}

/**
 * Stream `url` to `target` through a `.part` file, reporting progress.
 * The rename at the end is what makes a finished download atomic — a killed
 * app leaves a `.part`, never a truncated `.gguf` that looks real.
 */
async function downloadToFile(
  url: string,
  target: string,
  opts: { signal: AbortSignal; onBytes: (received: number, total: number) => void },
): Promise<number> {
  const response = await fetch(url, { signal: opts.signal, redirect: 'follow' })
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url.split('/').slice(-1)[0]}`)
  const headerTotal = Number(response.headers.get('content-length') ?? response.headers.get('x-linked-size') ?? 0)
  const total = isFinite(headerTotal) && headerTotal > 0 ? headerTotal : 0
  if (!response.body) throw new Error('Empty response body')
  await fs.mkdir(path.dirname(target), { recursive: true })
  // `.part` until the last byte lands: an interrupted download never leaves a
  // file that looks like a finished model.
  const partPath = `${target}.part`
  const handle = await fs.open(partPath, 'w')
  let received = 0
  try {
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      await handle.write(chunk)
      received += chunk.byteLength
      opts.onBytes(received, total)
    }
  } catch (err) {
    await handle.close().catch(() => {})
    await fs.rm(partPath, { force: true })
    throw err
  }
  await handle.close()
  if (total > 0 && received !== total) {
    await fs.rm(partPath, { force: true })
    throw new Error(`Truncated download: ${received} of ${total} bytes`)
  }
  await fs.rename(partPath, target)
  return received
}

/** Search GGUF repos. Empty query returns the most-downloaded GGUF models. */
export async function searchModels(query: string): Promise<HfModelEntry[]> {
  const url = query.trim() ? hfSearchUrl(query) : 'https://huggingface.co/api/models?filter=gguf&sort=downloads&direction=-1&limit=24'
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Hugging Face search failed: HTTP ${response.status}`)
  return parseHfSearch(await response.json())
}

/** Every `.gguf` in the repo (with sizes/quants) — what the file picker shows. */
export async function listGgufFiles(repoId: string): Promise<HfGgufFile[]> {
  const response = await fetch(hfTreeUrl(repoId))
  if (response.status === 404) throw new Error(`Repository not found: ${repoId}`)
  if (!response.ok) throw new Error(`Hugging Face tree failed: HTTP ${response.status}`)
  return parseHfTree(await response.json())
}

/** Read the manifest; a missing or corrupt file is simply "no models yet". */
export async function readManifest(): Promise<DownloadedModel[]> {
  try {
    const parsed = JSON.parse(await fs.readFile(MANIFEST_PATH, 'utf-8'))
    return Array.isArray(parsed) ? (parsed as DownloadedModel[]) : []
  } catch {
    return []
  }
}

async function writeManifest(entries: DownloadedModel[]): Promise<void> {
  await fs.mkdir(MODELS_DIR, { recursive: true })
  const tmp = `${MANIFEST_PATH}.tmp-${process.pid}`
  await fs.writeFile(tmp, JSON.stringify(entries, null, 2), 'utf-8')
  await fs.rename(tmp, MANIFEST_PATH)
}

/** Manifest rows whose files still exist on disk (a manual delete is respected). */
export async function listDownloaded(): Promise<DownloadedModel[]> {
  const entries = await readManifest()
  const alive: DownloadedModel[] = []
  for (const entry of entries) {
    try {
      await fs.access(entry.path)
      alive.push(entry)
    } catch {
      /* file gone — drop the row on the next manifest write */
    }
  }
  if (alive.length !== entries.length) await writeManifest(alive)
  return alive
}

/**
 * Download `file` from `repoId` (all parts, when it is a split model), append
 * the manifest row and emit progress through `onProgress`.
 *
 * Long-running: the IPC handler awaits it so the renderer's promise resolves
 * on completion; cancel goes through `cancelDownload` → AbortController.
 */
export async function downloadModel(
  repoId: string,
  file: string,
  onProgress: (progress: DownloadProgress) => void,
): Promise<DownloadedModel> {
  const key = downloadKey(repoId, file)
  if (activeJobs.has(key)) throw new Error(`Already downloading ${key}`)
  const controller = new AbortController()
  activeJobs.set(key, controller)
  const emit = (progress: DownloadProgress) => onProgress(progress)
  try {
    const allFiles = await listGgufFiles(repoId)
    const chosen = allFiles.find((f) => f.path === file) ?? {
      path: file, sizeBytes: 0, quant: 'UNKNOWN', paramsB: null,
    }
    const parts = expandShards(allFiles, chosen)
    const target = safeModelTarget(MODELS_DIR, repoId, parts[0].path, path)
    if (!target) throw new Error(`Unsafe model path: ${parts[0].path}`)

    const knownTotal = parts.reduce((sum, part) => sum + part.sizeBytes, 0)
    let completedReceived = 0
    // knownTotal from the tree API is the authority; fall back to the first
    // part's content-length when the tree did not carry sizes.
    let total = knownTotal
    emit({ key, repoId, file, received: 0, total, state: 'running' })

    for (const part of parts) {
      const partTarget = safeModelTarget(MODELS_DIR, repoId, part.path, path)
      if (!partTarget) throw new Error(`Unsafe model path: ${part.path}`)
      const written = await downloadToFile(hfDownloadUrl(repoId, part.path), partTarget.full, {
        signal: controller.signal,
        onBytes: (partReceived, partTotal) => {
          if (total === 0 && partTotal > 0) total = partTotal
          emit({ key, repoId, file, received: completedReceived + partReceived, total, state: 'running' })
        },
      })
      completedReceived += written
    }

    const primary = safeModelTarget(MODELS_DIR, repoId, parts[0].path, path)
    if (!primary) throw new Error('Unsafe model path')
    const entry: DownloadedModel = {
      repoId,
      file: parts[0].path,
      files: parts.map((p) => p.path),
      quant: chosen.quant,
      paramsB: chosen.paramsB,
      sizeBytes: parts.reduce((sum, part) => sum + (part.sizeBytes || 0), 0) || completedReceived,
      path: primary.full,
      downloadedAt: Date.now(),
    }
    const manifest = await readManifest()
    const next = manifest.filter((m) => !(m.repoId === repoId && m.file === entry.file))
    next.push(entry)
    await writeManifest(next)
    emit({ key, repoId, file, received: entry.sizeBytes, total: entry.sizeBytes, state: 'done', model: entry })
    return entry
  } catch (err) {
    const message = (err as Error).message ?? String(err)
    const canceled = (err as Error).name === 'AbortError' || controller.signal.aborted
    emit({ key, repoId, file, received: 0, total: 0, state: canceled ? 'canceled' : 'error', error: canceled ? undefined : message })
    throw canceled ? new Error('canceled') : err
  } finally {
    activeJobs.delete(key)
  }
}

export function cancelDownload(repoId: string, file: string): void {
  activeJobs.get(downloadKey(repoId, file))?.abort()
}

/** Delete a downloaded model's files and its manifest row. */
export async function removeModel(repoId: string, file: string): Promise<void> {
  const manifest = await readManifest()
  const entry = manifest.find((m) => m.repoId === repoId && m.file === file)
  if (!entry) return
  for (const stored of entry.files.length > 0 ? entry.files : [entry.file]) {
    const target = safeModelTarget(MODELS_DIR, repoId, stored, path)
    if (target) await fs.rm(target.full, { force: true })
  }
  try {
    await fs.rmdir(path.dirname(entry.path)) // remove the repo folder when empty
  } catch {
    /* other quants still live there */
  }
  await writeManifest(manifest.filter((m) => !(m.repoId === repoId && m.file === file)))
}

export { downloadToFile }
