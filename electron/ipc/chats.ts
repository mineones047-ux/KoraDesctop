import { ipcMain } from 'electron'
import fs from 'fs/promises'
import fsSync from 'fs'
import path from 'path'
import os from 'os'

const CHATS_FILE = path.join(os.homedir(), '.kora', 'chats.json')
const TMP_SUFFIX = '.kora-tmp-' + process.pid + '-' + Math.random().toString(36).slice(2, 8)

function sanitizeChats(value: unknown): unknown {
  if (!Array.isArray(value)) return []
  return value
    .filter((c): c is Record<string, unknown> => !!c && typeof c === 'object')
    .map((c) => ({
      id: typeof c.id === 'string' ? c.id : '',
      title: typeof c.title === 'string' ? c.title : '',
      createdAt: typeof c.createdAt === 'number' ? c.createdAt : Date.now(),
      updatedAt: typeof c.updatedAt === 'number' ? c.updatedAt : Date.now(),
      messages: Array.isArray(c.messages)
        ? c.messages
            .filter((m): m is Record<string, unknown> => !!m && typeof m === 'object')
            .map((m) => ({
              id: typeof m.id === 'string' ? m.id : '',
              role: typeof m.role === 'string' ? m.role : 'user',
              content: typeof m.content === 'string' ? m.content : '',
              timestamp: typeof m.timestamp === 'number' ? m.timestamp : Date.now(),
            }))
        : [],
    }))
    .filter((c) => c.id)
}

async function loadChatsWithBackup(): Promise<unknown[]> {
  let content: string
  try {
    content = await fs.readFile(CHATS_FILE, 'utf-8')
  } catch {
    return [] // first run — no file yet
  }
  try {
    const parsed = JSON.parse(content)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    // Corrupted file (crash mid-write, disk issue): keep it for recovery
    // instead of letting the next save silently wipe the history.
    const backup = CHATS_FILE + '.corrupt-' + Date.now()
    console.error(`[KORA] chats.json is corrupted, backing up to ${backup}`)
    try {
      await fs.rename(CHATS_FILE, backup)
    } catch {
      // ignore
    }
    return []
  }
}

export function registerChatHandlers() {
  ipcMain.handle('chats:load', async () => {
    const chats = await loadChatsWithBackup()
    return sanitizeChats(chats)
  })

  ipcMain.handle('chats:save', async (_event, chats: unknown) => {
    const dir = path.dirname(CHATS_FILE)
    await fs.mkdir(dir, { recursive: true })
    const safe = sanitizeChats(chats)
    const tmp = CHATS_FILE + TMP_SUFFIX
    await fs.writeFile(tmp, JSON.stringify(safe, null, 2))
    await fs.rename(tmp, CHATS_FILE)
    return { success: true }
  })

  ipcMain.on('chats:saveSync', (event, chats: unknown) => {
    try {
      const safe = sanitizeChats(chats)
      const dir = path.dirname(CHATS_FILE)
      fsSync.mkdirSync(dir, { recursive: true })
      const tmp = CHATS_FILE + TMP_SUFFIX
      fsSync.writeFileSync(tmp, JSON.stringify(safe, null, 2))
      fsSync.renameSync(tmp, CHATS_FILE)
      event.returnValue = { success: true }
    } catch (err) {
      event.returnValue = { success: false, error: (err as Error).message }
    }
  })
}
