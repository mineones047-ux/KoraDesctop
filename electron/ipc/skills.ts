/**
 * Agent skills over IPC (`fs:installSkill`): let the agent (or the user) install
 * a ready-made skill from a URL into `~/.kora/skills/<name>/`.
 *
 * Guards on the main process side, because the caller (a model) is untrusted:
 *   * https-only fetch through the same SSRF-guarded transport web:fetch uses;
 *   * size cap — a skill is instructions, not a dataset;
 *   * the directory name is derived from the URL path, slugified and length-capped,
 *     so `../` never reaches the filesystem;
 *   * a later install of the same name overwrites the files — the skill directory
 *     is a cache of its source, not user work in progress (covered by the
 *     confirmation the renderer asks for before calling this).
 */
import { ipcMain } from 'electron'
import fs from 'fs/promises'
import path from 'path'
import os from 'os'
import { lookup } from 'dns/promises'
import { guardedFetch } from '../lib/ssrf-guard'

const MAX_SKILL_BYTES = 100 * 1024

/** A fresh copy of the official README explains the SKILL.md format the crate loads. */
export function registerSkillHandlers(): void {
  ipcMain.handle('fs:installSkill', async (_event, rawUrl: string) => {
    try {
      let url: URL
      try {
        url = new URL(String(rawUrl ?? ''))
      } catch {
        return { success: false, error: 'Invalid URL' }
      }
      if (url.protocol !== 'https:') {
        return { success: false, error: 'Only https:// URLs are allowed' }
      }

      const response = await guardedFetch(
        url.toString(),
        { method: 'GET', redirect: 'manual' },
        {
          fetchImpl: (u, init) => fetch(u, init),
          lookupImpl: async (host) => {
            const r = await lookup(host, { all: true })
            return r.map((a) => a.address)
          },
        },
      )
      if (!response.response.ok) {
        return { success: false, error: `HTTP ${response.response.status}` }
      }

      const declared = Number(response.response.headers.get('content-length') ?? 0)
      if (declared > MAX_SKILL_BYTES) {
        return { success: false, error: `Skill too large (${declared} bytes, max ${MAX_SKILL_BYTES})` }
      }
      const buffer = await response.response.arrayBuffer()
      if (buffer.byteLength > MAX_SKILL_BYTES) {
        return { success: false, error: `Skill too large (max ${MAX_SKILL_BYTES} bytes)` }
      }
      const text = new TextDecoder().decode(buffer)

      // Name = last path segment, slugified; the renderer strips the extension.
      const base = decodeURIComponent(url.pathname).split('/').filter(Boolean).pop() ?? 'skill'
      const slug = base
        .toLowerCase()
        .replace(/\.(md|txt|markdown)$/i, '')
        .replace(/[^a-z0-9_-]+/g, '-')
        .replace(/^-+/, '')
        .slice(0, 64) || 'skill'
      const dir = path.join(os.homedir(), '.kora', 'skills', slug)
      await fs.mkdir(dir, { recursive: true })
      const skillFile = path.join(dir, 'SKILL.md')
      await fs.writeFile(skillFile, text, 'utf-8')
      return { success: true, path: dir, name: slug }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })
}
