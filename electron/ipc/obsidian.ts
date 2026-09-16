import { ipcMain, dialog, BrowserWindow } from 'electron'
import fs from 'fs/promises'
import path from 'path'
import { config } from '../services/config'

interface ObsidianNode {
  id: string
  title: string
  path: string
  folder: string
  tags: string[]
}

interface ObsidianGraph {
  nodes: ObsidianNode[]
  links: { source: string; target: string }[]
  error?: string
}

const SKIP_DIRS = new Set(['.obsidian', '.trash', '.git', 'node_modules'])
const MAX_SCAN_FILES = 5000
const MAX_SCAN_DEPTH = 15

// Cache the last scan so rapid re-opens of the graph don't rescan the whole
// vault (up to MAX_SCAN_FILES files read + parsed) on every navigation.
const SCAN_CACHE_TTL_MS = 30_000
let scanCache: { vault: string; at: number; graph: ObsidianGraph } | null = null

function stripBom(s: string): string {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s
}

/** Iterative scan with symlink protection and a hard cap on file count/depth. */
async function listVaultFiles(vault: string): Promise<string[]> {
  const files: string[] = []
  const queue: Array<{ dir: string; depth: number }> = [{ dir: vault, depth: 0 }]
  while (queue.length > 0) {
    const { dir, depth } = queue.shift()!
    if (depth > MAX_SCAN_DEPTH || files.length > MAX_SCAN_FILES) continue
    let dirents: any[]
    try {
      dirents = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const d of dirents as any[]) {
      if (d.isSymbolicLink()) continue // junction/symlink loops
      const full = path.join(dir, d.name)
      if (d.isDirectory()) {
        if (!SKIP_DIRS.has(d.name)) queue.push({ dir: full, depth: depth + 1 })
      } else if (d.isFile() && d.name.toLowerCase().endsWith('.md')) {
        const rel = path.relative(vault, full)
        const parts = rel.split(/[\\/]/)
        if (!parts.some((p) => SKIP_DIRS.has(p))) {
          files.push(full)
          if (files.length > MAX_SCAN_FILES) return files.sort()
        }
      }
    }
  }
  return files.sort()
}

async function readVaultFile(file: string): Promise<string | null> {
  let content: string
  try {
    content = await fs.readFile(file, 'utf-8')
  } catch {
    return null
  }
  content = stripBom(content)
  if (content.length > 1_000_000) content = content.slice(0, 1_000_000)
  return content
}

function extractTitle(filePath: string, content: string): string {
  const firstLine = content.split(/\r?\n/, 1)[0] ?? ''
  const h1 = /^#\s+(.+)$/.exec(firstLine.trim())
  if (h1) return h1[1].trim()
  return path.basename(filePath, '.md')
}

function extractTags(content: string): string[] {
  const tags = new Set<string>()
  for (const line of content.split(/\r?\n/)) {
    if (line.trim().startsWith('# ')) continue
    const re = /#([\p{L}\p{N}_-]+)/gu
    let m: RegExpExecArray | null
    while ((m = re.exec(line)) !== null) {
      if (!m[1].startsWith('http')) tags.add(m[1])
    }
  }
  return [...tags]
}

function extractLinks(content: string): string[] {
  const links = new Set<string>()
  const re = /\[\[([^\]|#]+)(?:#[^\]]*)?(?:\|[^\]]*)?\]\]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(content)) !== null) {
    links.add(m[1].trim())
  }
  return [...links]
}

function vaultPathOrThrow(): string {
  const vault = (config.get() as any).obsidianVaultPath as string
  if (!vault || !vault.trim()) {
    throw new Error('Obsidian vault not configured. Set the vault path in Settings → Knowledge.')
  }
  return vault.trim()
}

async function scanVault(): Promise<ObsidianGraph> {
  const vault = vaultPathOrThrow()

  let files: string[]
  try {
    if (!(await fs.stat(vault)).isDirectory()) {
      throw new Error(`Vault path is not a folder: ${vault}`)
    }
    files = await listVaultFiles(vault)
  } catch (err: any) {
    if (err?.code === 'ENOENT') {
      throw new Error(`Vault folder not found: ${vault}`)
    }
    throw err
  }

  // Read each file exactly once; keep contents for both metadata and link extraction
  const nodes: ObsidianNode[] = []
  const byBasename = new Map<string, string>()
  const byRelPath = new Map<string, string>()
  const contents = new Map<string, string>()

  for (const file of files) {
    const content = await readVaultFile(file)
    if (content === null) continue

    const rel = path.relative(vault, file).replace(/\\/g, '/')
    const id = rel.replace(/\.md$/i, '')
    const base = path.basename(id)
    const node: ObsidianNode = {
      id,
      title: extractTitle(file, content),
      path: rel,
      folder: id.includes('/') ? id.split('/')[0] : 'root',
      tags: extractTags(content),
    }
    nodes.push(node)
    contents.set(file, content)

    const keyBase = base.toLowerCase()
    if (!byBasename.has(keyBase)) byBasename.set(keyBase, id)
    byRelPath.set(id.toLowerCase(), id)
  }

  const links: { source: string; target: string }[] = []
  const nodeIds = new Set(nodes.map((n) => n.id))

  for (const [file, content] of contents) {
    const rel = path.relative(vault, file).replace(/\\/g, '/')
    const source = rel.replace(/\.md$/i, '')
    if (!nodeIds.has(source)) continue

    for (const targetRaw of extractLinks(content)) {
      const targetNorm = targetRaw.replace(/\\/g, '/').replace(/\.md$/i, '')
      const found =
        byRelPath.get(targetNorm.toLowerCase()) ??
        byRelPath.get(targetNorm.toLowerCase().split('/').slice(-1)[0]) ??
        byBasename.get(targetNorm.toLowerCase().split('/').slice(-1)[0])
      if (found && found !== source) {
        links.push({ source, target: found })
      }
    }
  }

  return { nodes, links }
}

export function registerObsidianHandlers() {
  ipcMain.handle('obsidian:scan', async (): Promise<ObsidianGraph> => {
    try {
      const vault = vaultPathOrThrow()
      const now = Date.now()
      if (scanCache && scanCache.vault === vault && now - scanCache.at < SCAN_CACHE_TTL_MS) {
        return scanCache.graph
      }
      const graph = await scanVault()
      scanCache = { vault, at: Date.now(), graph }
      return graph
    } catch (err: any) {
      scanCache = null
      return { nodes: [], links: [], error: err?.message ?? String(err) }
    }
  })

  ipcMain.handle('obsidian:readNote', async (_e, id: string): Promise<{ success: boolean; content?: string; error?: string }> => {
    try {
      const vault = vaultPathOrThrow()
      if (typeof id !== 'string' || !id || id.includes('..')) {
        return { success: false, error: 'Invalid note id' }
      }
      const resolved = path.resolve(vault, id.replace(/\\/g, '/') + '.md')
      if (!resolved.toLowerCase().startsWith(path.resolve(vault).toLowerCase())) {
        return { success: false, error: 'Path outside vault' }
      }
      const content = await fs.readFile(resolved, 'utf-8')
      return { success: true, content }
    } catch (err: any) {
      return { success: false, error: err?.message ?? String(err) }
    }
  })

  ipcMain.handle('obsidian:pickVault', async (e): Promise<{ success: boolean; path?: string; error?: string }> => {
    try {
      const win = BrowserWindow.fromWebContents(e.sender)
      const result = await dialog.showOpenDialog(win && !win.isDestroyed() ? win : {
        title: 'Select Obsidian vault folder',
        properties: ['openDirectory'],
      } as any)
      if (result.canceled || result.filePaths.length === 0) {
        return { success: false, error: 'cancelled' }
      }
      return { success: true, path: result.filePaths[0] }
    } catch (err: any) {
      return { success: false, error: err?.message ?? String(err) }
    }
  })
}
