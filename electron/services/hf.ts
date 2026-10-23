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
import { expandShards, hfDownloadUrl, hfSearchUrl, hfTreeUrl, parseHfSearch, parseHfTree, safeModelTarget, shardGroup } from './local-llm'

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
  state: 'running' | 'done' | 'error' | 'paused'
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
 *
 * Resumable: if a `.part` already exists, its size becomes the starting offset
 * (`Range: bytes=N-`) and the file is appended to. A server that answers `200`
 * instead of `206` restarts cleanly, and a mismatch against Content-Length
 * throws the part away rather than renaming a corrupt model.
 */
async function downloadToFile(
  url: string,
  target: string,
  opts: { signal: AbortSignal; onBytes: (received: number, total: number) => void },
): Promise<number> {
  await fs.mkdir(path.dirname(target), { recursive: true })
  const partPath = `${target}.part`
  let offset = 0
  try {
    offset = (await fs.stat(partPath)).size
  } catch {
    /* no part yet — start from zero */
  }
  const headers: Record<string, string> = {}
  if (offset > 0) headers.range = `bytes=${offset}-`
  const response = await fetch(url, { signal: opts.signal, redirect: 'follow', headers })
  if (offset > 0 && response.status === 200) {
    // The server ignored the Range header: the body is the whole file again.
    offset = 0
    await fs.rm(partPath, { force: true })
  }
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url.split('/').slice(-1)[0]}`)
  // Total size of the *whole* file, not of this response: `Content-Range` is
  // authoritative when the server honoured the Range header, `Content-Length`
  // covers the remaining bytes, and `x-linked-size` (Hugging Face) is the size
  // of the original object.
  const contentLength = Number(response.headers.get('content-length') ?? 0)
  const linkedSize = Number(response.headers.get('x-linked-size') ?? 0)
  const contentRange = response.headers.get('content-range') ?? ''
  const rangeTotal = Number(contentRange.split('/')[1] ?? 0)
  let total = 0
  if (isFinite(rangeTotal) && rangeTotal > 0) total = rangeTotal
  else if (isFinite(contentLength) && contentLength > 0) total = contentLength + offset
  else if (isFinite(linkedSize) && linkedSize > 0) total = linkedSize
  if (!response.body) throw new Error('Empty response body')
  // `.part` until the last byte lands: an interrupted download never leaves a
  // file that looks like a finished model. Append mode keeps resumable bytes.
  const handle = await fs.open(partPath, 'a')
  let received = 0 // bytes beyond the offset
  try {
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      await handle.write(chunk)
      received += chunk.byteLength
      opts.onBytes(offset + received, total)
    }
  } catch (err) {
    await handle.close().catch(() => {})
    // The part survives an abort (resume later) and an unknown-transport error,
    // but a *truncated* stream is safer to discard than to re-append to.
    if (!controllerAborted(opts.signal) && total > 0 && offset + received < total) {
      await fs.rm(partPath, { force: true })
    }
    throw err
  }
  await handle.close()
  if (total > 0 && offset + received !== total) {
    await fs.rm(partPath, { force: true })
    throw new Error(`Truncated download: ${offset + received} of ${total} bytes`)
  }
  await fs.rename(partPath, target)
  return offset + received
}

function controllerAborted(signal: AbortSignal): boolean {
  return signal.aborted
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
  // Last known progress, so a pause can report where it stopped.
  let lastReceived = 0
  let lastTotal = 0
  const emit = (progress: DownloadProgress) => {
    if (progress.received > 0) lastReceived = progress.received
    if (progress.total > 0) lastTotal = progress.total
    onProgress(progress)
  }
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
    // Bytes already on disk (a resumed download) — the progress bar starts here
    // instead of at zero, so a pause looks like a pause and not like a restart.
    emit({ key, repoId, file, received: 0, total, state: 'running' })

    for (const part of parts) {
      const partTarget = safeModelTarget(MODELS_DIR, repoId, part.path, path)
      if (!partTarget) throw new Error(`Unsafe model path: ${part.path}`)
      // A shard that already landed (a previous run of a split model) is not
      // fetched again — otherwise resuming a 4-part model would re-download
      // every finished part.
      if (await partAlreadyComplete(partTarget.full, part.sizeBytes)) {
        completedReceived += part.sizeBytes || 0
        emit({ key, repoId, file, received: completedReceived, total, state: 'running' })
        continue
      }
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
    const paused = (err as Error).name === 'AbortError' || controller.signal.aborted
    // A pause keeps the partial `.part` on disk: the next call to this function
    // resumes from that byte instead of starting over.
    emit({
      key,
      repoId,
      file,
      received: paused ? lastReceived : 0,
      total: paused ? lastTotal : 0,
      state: paused ? 'paused' : 'error',
      error: paused ? undefined : message,
    })
    throw paused ? new Error('paused') : err
  } finally {
    activeJobs.delete(key)
  }
}

/** True when a shard is already fully on disk from an earlier run. */
async function partAlreadyComplete(target: string, expectedSize: number): Promise<boolean> {
  if (!expectedSize || expectedSize <= 0) return false
  try {
    const stat = await fs.stat(target)
    return stat.size === expectedSize
  } catch {
    return false
  }
}

/**
 * Pause a running download. The partial file stays on disk, so the same
 * download call resumes it later.
 */
export function cancelDownload(repoId: string, file: string): void {
  activeJobs.get(downloadKey(repoId, file))?.abort()
}

/**
 * Bytes of a paused download that are already on disk.
 *
 * The UI asks for this when it opens the model list, so a download that was
 * paused (or interrupted by a crash) can be offered as "resume" instead of
 * looking like it never started.
 */
export async function partialBytes(repoId: string, file: string): Promise<number> {
  const target = safeModelTarget(MODELS_DIR, repoId, file, path)
  if (!target) return 0
  const group = shardGroup(file)
  try {
    const entries = await fs.readdir(target.dir, { withFileTypes: true })
    let total = 0
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.part')) continue
      const name = entry.name.slice(0, -'.part'.length)
      // Only the parts of this model's own shard group count.
      if (group) {
        const g = shardGroup(name)
        if (!g || g.prefix !== group.prefix) continue
      } else if (name !== target.fileName) {
        continue
      }
      const stat = await fs.stat(path.join(target.dir, entry.name))
      total += stat.size
    }
    return total
  } catch {
    return 0
  }
}

/**
 * Every paused download of one repo: the file it belongs to and how many
 * bytes are already on disk. One call per repo keeps the file list responsive.
 */
export async function listPartials(repoId: string): Promise<{ file: string; bytes: number }[]> {
  const slug = repoId.replace(/[^\w.-]+/g, '_').slice(0, 120) || 'unknown'
  const dir = path.join(MODELS_DIR, slug)
  const out: { file: string; bytes: number }[] = []
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.part')) continue
      const stat = await fs.stat(path.join(dir, entry.name))
      out.push({ file: entry.name.slice(0, -'.part'.length), bytes: stat.size })
    }
  } catch {
    /* no models folder for this repo yet */
  }
  return out
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
