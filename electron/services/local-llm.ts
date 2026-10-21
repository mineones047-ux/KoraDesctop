/**
 * Pure helpers behind the Local AI tab: PC profiling, model/quant parsing,
 * Hugging Face URL + payload parsing and the llama.cpp engine asset choice.
 *
 * No Electron imports, no network, no fs — everything in this file is unit-tested
 * (electron/__tests__/local-llm.test.ts). The services that do the real work
 * (hf.ts, llama-engine.ts) are thin I/O wrappers around these functions.
 */

/** What the machine has, as seen from the main process. */
export interface PcProfile {
  ramGb: number
  cpuCores: number
  /** NVIDIA VRAM in GB when nvidia-smi answers, else null. */
  vramGb: number | null
}

/** The model class this machine should run: biggest that fits, best quant that fits it. */
export interface Recommendation {
  /** Upper bound in billions of parameters. */
  maxParamsB: number
  /** Preferred quantisation for this RAM size. */
  quant: string
}

export interface HfModelEntry {
  id: string
  downloads: number
  likes: number
  /** Billions of parameters parsed out of the repo name, when it advertises one. */
  paramsB: number | null
}

export interface HfGgufFile {
  /** Repo-relative path (subfolders allowed). */
  path: string
  sizeBytes: number
  quant: string
  paramsB: number | null
  /** Set for split models: the `name-00001-of-00002` prefix all parts share. */
  shardPrefix?: string
}

/** One row of `~/.kora/models/models.json`. */
export interface DownloadedModel {
  repoId: string
  /** Primary file — the single file, or the first shard of a split model. */
  file: string
  /** Every file that belongs to this entry (split models have several). */
  files: string[]
  quant: string
  paramsB: number | null
  sizeBytes: number
  /** Absolute path of the primary file — what llama-server gets via `-m`. */
  path: string
  downloadedAt: number
}

export interface EngineAsset {
  name: string
  url: string
  sizeBytes: number
}

/** Quant preference for a given RAM size: quality first, download size second. */
export function recommendFor(profile: PcProfile): Recommendation {
  const ram = profile.ramGb
  let maxParamsB: number
  if (ram >= 64) maxParamsB = 70
  else if (ram >= 40) maxParamsB = 32
  else if (ram >= 22) maxParamsB = 14
  else if (ram >= 13) maxParamsB = 8
  else if (ram >= 8) maxParamsB = 4
  else maxParamsB = 3
  // 22 GB+ comfortably holds a Q5 of the target class; below that the extra
  // gigabytes are better spent on a bigger model at Q4.
  const quant = ram >= 22 ? 'Q5_K_M' : 'Q4_K_M'
  return { maxParamsB, quant }
}

/**
 * `"Llama-3.2-3B-Instruct"` → 3, `"Qwen2.5-1.5B"` → 1.5, `"SmolLM2-135M"` → null.
 *
 * The digit+`B` unit is the only signal GGUF repos share consistently; the guard
 * keeps version numbers (`2.5B`-looking `2.5-`) and letter suffixes (`3B2`) out.
 */
export function parseParamsB(name: string): number | null {
  const match = name.match(/(?:^|[^\dA-Za-z])(\d+(?:\.\d+)?)B(?=[^A-Za-z]|$)/i)
  if (!match) return null
  const value = Number(match[1])
  if (!isFinite(value) || value < 0.1 || value > 1000) return null
  return value
}

/** `"model-Q4_K_M.gguf"` → `"Q4_K_M"`, `".../f16.gguf"` → `"F16"`, else null. */
export function quantOfFile(fileName: string): string | null {
  const match = fileName.match(
    /(IQ\d(?:_[A-Z0-9]+)+|Q[2-8]_[KM]\d?_[SLM]|Q[2-8]_[KM]|Q[2-8]_[0458](?:_0)?|BF16|F16|FP16)/i,
  )
  return match ? match[1].toUpperCase() : null
}

/** `"model-00001-of-00002.gguf"` → `{ prefix: 'model', index: 1, total: 2 }`. */
export function shardGroup(filePath: string): { prefix: string; index: number; total: number } | null {
  const match = filePath.match(/^(.*)-(\d{5})-of-(\d{5})\.gguf$/i)
  if (!match) return null
  return { prefix: match[1], index: Number(match[2]), total: Number(match[3]) }
}

/**
 * Order quants from best quality-per-GB to worst; the recommendation's own
 * quant is tried first by `pickBestFile`.
 */
const QUANT_ORDER = [
  'Q6_K', 'Q5_K_M', 'Q5_K_S', 'Q4_K_M', 'Q4_K_S', 'IQ4_XS', 'Q4_0', 'Q8_0',
  'IQ3_M', 'Q3_K_M', 'IQ2_XXS', 'Q3_K_S', 'Q2_K', 'F16', 'BF16',
]

function quantRank(quant: string): number {
  const idx = QUANT_ORDER.indexOf(quant)
  return idx === -1 ? QUANT_ORDER.length : idx
}

/**
 * Is this file's parameter count something this PC should actually run?
 * "Recommended" = at least half of the machine's ceiling (a 0.5B on a 14 GB
 * box runs but wastes the hardware), "fits" = anything at or under the ceiling.
 */
export function fitsProfile(paramsB: number | null, profile: PcProfile): boolean {
  if (paramsB == null) return false
  return paramsB <= recommendFor(profile).maxParamsB
}

export function recommendsProfile(paramsB: number | null, profile: PcProfile): boolean {
  if (paramsB == null) return false
  const max = recommendFor(profile).maxParamsB
  return paramsB <= max && paramsB >= Math.max(1, Math.floor(max / 2))
}

/**
 * Best single file for this PC out of a repo's GGUF list.
 *
 * Preference: quant tier first (the recommendation's quant, then QUANT_ORDER),
 * then the largest model that still fits, then a smaller download. Unknown
 * parameter counts lose to known ones — we only recommend what we can prove fits.
 */
export function pickBestFile(
  files: HfGgufFile[],
  profile: PcProfile,
): HfGgufFile | null {
  const rec = recommendFor(profile)
  const fitting = files.filter((f) => f.paramsB != null && f.paramsB <= rec.maxParamsB)
  const pool = fitting.length > 0 ? fitting : files.filter((f) => f.paramsB == null)
  if (pool.length === 0) return null
  const recRank = quantRank(rec.quant)
  // Lower is better: the recommended quant wins, then QUANT_ORDER distance.
  const tier = (file: HfGgufFile): number =>
    file.quant === rec.quant ? -1 : Math.abs(quantRank(file.quant) - recRank)
  return [...pool].sort((a, b) =>
    tier(a) - tier(b) ||
    (b.paramsB ?? -1) - (a.paramsB ?? -1) ||
    a.sizeBytes - b.sizeBytes,
  )[0]
}

/** `['Qwen/Qwen2.5-7B-GGUF', ...]` → entries with parsed params, ids kept unique. */
export function parseHfSearch(json: unknown): HfModelEntry[] {
  if (!Array.isArray(json)) return []
  const seen = new Set<string>()
  const out: HfModelEntry[] = []
  for (const raw of json) {
    const item = raw as Record<string, unknown>
    const id = typeof item.id === 'string' ? item.id : typeof item.modelId === 'string' ? item.modelId : null
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push({
      id,
      downloads: typeof item.downloads === 'number' ? item.downloads : 0,
      likes: typeof item.likes === 'number' ? item.likes : 0,
      paramsB: parseParamsB(id),
    })
  }
  return out
}

/** HF `/tree/main?recursive=true` → the `.gguf` files with sizes and quants. */
export function parseHfTree(json: unknown): HfGgufFile[] {
  if (!Array.isArray(json)) return []
  const out: HfGgufFile[] = []
  for (const raw of json) {
    const item = raw as Record<string, unknown>
    const filePath = typeof item.path === 'string' ? item.path : null
    if (!filePath || !filePath.toLowerCase().endsWith('.gguf')) continue
    if (item.type === 'directory') continue
    const lfs = item.lfs as { size?: number } | undefined
    const size = typeof item.size === 'number' ? item.size : typeof lfs?.size === 'number' ? lfs.size : 0
    const shard = shardGroup(filePath)
    out.push({
      path: filePath,
      sizeBytes: size,
      quant: quantOfFile(filePath) ?? 'UNKNOWN',
      paramsB: parseParamsB(filePath),
      shardPrefix: shard ? shard.prefix : undefined,
    })
  }
  return out.sort((a, b) => a.path.localeCompare(b.path))
}

/** Every file belonging to `chosen` — itself, or all parts of its split group. */
export function expandShards(files: HfGgufFile[], chosen: HfGgufFile): HfGgufFile[] {
  // Derived from the name, not from a precomputed field, so a caller can pass
  // hand-built entries and still get the whole group.
  const shard = shardGroup(chosen.path)
  if (!shard) return [chosen]
  const parts = files.filter((f) => shardGroup(f.path)?.prefix === shard.prefix)
  return parts.length > 0 ? parts : [chosen]
}

const HF = 'https://huggingface.co'

const encodeSeg = (value: string) => encodeURIComponent(value)

export function hfSearchUrl(query: string): string {
  const q = query.trim().replace(/\s+/g, ' ')
  return `${HF}/api/models?search=${encodeSeg(q)}&filter=gguf&sort=downloads&direction=-1&limit=24`
}

export function hfTreeUrl(repoId: string): string {
  return `${HF}/api/models/${repoId.split('/').map(encodeSeg).join('/')}/tree/main?recursive=true`
}

export function hfDownloadUrl(repoId: string, filePath: string): string {
  return `${HF}/${repoId.split('/').map(encodeSeg).join('/')}/resolve/main/${filePath.split('/').map(encodeSeg).join('/')}`
}

/**
 * Absolute target for a download inside `modelsDir`, or null when the pair
 * escapes the directory (repo/file come from the network, never trust them).
 */
export function safeModelTarget(
  modelsDir: string,
  repoId: string,
  filePath: string,
  pathModule: { join: (...parts: string[]) => string; basename: (p: string) => string; resolve: (p: string) => string; sep: string },
): { dir: string; fileName: string; full: string } | null {
  const repoSlug = repoId.replace(/[^\w.-]+/g, '_').slice(0, 120) || 'unknown'
  const fileName = pathModule.basename(filePath).replace(/[^\w.() -]+/g, '_').slice(0, 150)
  if (!fileName.toLowerCase().endsWith('.gguf')) return null
  const dir = pathModule.join(modelsDir, repoSlug)
  const full = pathModule.join(dir, fileName)
  const resolvedModels = pathModule.resolve(modelsDir) + pathModule.sep
  if (!pathModule.resolve(full).startsWith(resolvedModels)) return null
  return { dir, fileName, full }
}

/**
 * The llama.cpp Windows/macOS/Linux CPU build out of a GitHub releases page.
 *
 * Prefers the vendor CPU zip (no CUDA runtime to chase), never picks a CUDA
 * asset, and treats "no matching asset" as a real failure the UI can show.
 */
export function pickEngineAsset(
  assets: { name: string; url: string; sizeBytes: number }[],
  platform: string,
  arch: string,
): { name: string; url: string; sizeBytes: number } | null {
  const cpuPattern =
    platform === 'win32'
      ? /-bin-win-cpu-x64\.zip$/i
      : platform === 'darwin'
        ? arch === 'arm64' ? /-bin-macos-arm64\.zip$/i : /-bin-macos-x64\.zip$/i
        : arch === 'arm64' ? /-bin-ubuntu-.*arm64\.zip$/i : /-bin-ubuntu-x64\.zip$/i
  const platformPattern =
    platform === 'win32'
      ? /-bin-win-x64\.zip$/i
      : platform === 'darwin' ? /-bin-macos-.*\.zip$/i : /-bin-ubuntu-.*\.zip$/i
  const candidates = assets.filter((a) => /llama-b\d+-bin-/i.test(a.name) && !/cuda/i.test(a.name))
  return (
    candidates.find((a) => cpuPattern.test(a.name)) ??
    candidates.find((a) => platformPattern.test(a.name)) ??
    null
  )
}

/** `nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits` → GB (sum), or null. */
export function parseVramSmi(output: string): number | null {
  const values = output
    .split(/\r?\n/)
    .map((line) => Number(line.trim()))
    .filter((n) => isFinite(n) && n > 0)
  if (values.length === 0) return null
  const totalMiB = values.reduce((sum, n) => sum + n, 0)
  return Math.round((totalMiB / 1024) * 10) / 10
}
