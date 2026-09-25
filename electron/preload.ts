/**
 * Preload bridge: the ONLY channel between the sandboxed renderer and Node.
 *
 * Exposes window.kora.* as thin ipcRenderer wrappers — no business logic here.
 * Everything the renderer can do is enumerated in src/types/index.ts; every
 * counterpart handler must validate its inputs again in the main process.
 * chatStream creates a one-shot reply channel + a `<channel>:ctl` control channel.
 */
import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('kora', {
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    maximize: () => ipcRenderer.send('window:maximize'),
    close: () => ipcRenderer.send('window:close'),
    isMaximized: () => ipcRenderer.sendSync('window:isMaximized'),
    onMaximizedChange: (callback: (value: boolean) => void) => {
      const listener = (_e: unknown, value: boolean) => callback(value)
      ipcRenderer.on('window:maximized', listener)
      return () => ipcRenderer.removeListener('window:maximized', listener)
    },
  },

  system: {
    getInfo: () => ipcRenderer.invoke('system:info'),
    getProcesses: () => ipcRenderer.invoke('system:processes'),
    openApp: (path: string) => ipcRenderer.invoke('system:openApp', path),
    killProcess: (pid: number) => ipcRenderer.invoke('system:killProcess', pid),
    shutdown: () => ipcRenderer.invoke('system:shutdown'),
    restart: () => ipcRenderer.invoke('system:restart'),
    sleep: () => ipcRenderer.invoke('system:sleep'),
    lock: () => ipcRenderer.invoke('system:lock'),
    volume: (level: number) => ipcRenderer.invoke('system:volume', level),
    volumeUp: () => ipcRenderer.invoke('system:volumeUp'),
    volumeDown: () => ipcRenderer.invoke('system:volumeDown'),
    mute: () => ipcRenderer.invoke('system:mute'),
    brightness: (level: number) => ipcRenderer.invoke('system:brightness', level),
    windows: () => ipcRenderer.invoke('system:windows'),
  },

  fs: {
    readDir: (path: string) => ipcRenderer.invoke('fs:readDir', path),
    readFile: (path: string, maxBytes?: number) => ipcRenderer.invoke('fs:readFile', path, maxBytes),
    writeFile: (path: string, content: string) => ipcRenderer.invoke('fs:writeFile', path, content),
    patchFile: (filePath: string, oldText: string, newText: string, replaceAll?: boolean) =>
      ipcRenderer.invoke('fs:patchFile', filePath, oldText, newText, replaceAll),
    grep: (dirPath: string, pattern: string, options?: { include?: string; maxResults?: number; caseInsensitive?: boolean }) =>
      ipcRenderer.invoke('fs:grep', dirPath, pattern, options),
    getHomeDir: () => ipcRenderer.invoke('fs:homeDir'),
    deleteFile: (path: string) => ipcRenderer.invoke('fs:deleteFile', path),
    rename: (oldPath: string, newPath: string) => ipcRenderer.invoke('fs:rename', oldPath, newPath),
    copy: (oldPath: string, newPath: string) => ipcRenderer.invoke('fs:copy', oldPath, newPath),
    mkdir: (path: string) => ipcRenderer.invoke('fs:mkdir', path),
    stat: (path: string) => ipcRenderer.invoke('fs:stat', path),
    exists: (path: string) => ipcRenderer.invoke('fs:exists', path),
    findFiles: (pattern: string, options?: { searchDir?: string; maxResults?: number; maxDepth?: number }) =>
      ipcRenderer.invoke('fs:findFiles', pattern, options),
  },

  shell: {
    execute: (command: string, options?: { bypassDangerCheck?: boolean }) => 
      ipcRenderer.invoke('shell:execute', command, options),
  },

  ai: {
    chat: (messages: { role: string; content: string }[], options: { provider: string; model?: string; apiKey?: string; baseUrl?: string; temperature?: number; jsonMode?: boolean }) =>
      ipcRenderer.invoke('ai:chat', messages, options),

    chatStream: (messages: { role: string; content: string }[], options: { provider: string; model?: string; apiKey?: string; baseUrl?: string; temperature?: number; jsonMode?: boolean }, callback: (chunk: string) => void) => {
      const channel = `ai:stream:${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
      const listener = (_event: unknown, chunk: string) => callback(chunk)
      const ctlListener = (_event: unknown, ctl: string) => callback(ctl)
      ipcRenderer.on(channel, listener)
      ipcRenderer.on(`${channel}:ctl`, ctlListener)
      ipcRenderer.send('ai:chatStream', messages, options, channel)
      return {
        unsubscribe: () => {
          ipcRenderer.removeListener(channel, listener)
          ipcRenderer.removeListener(`${channel}:ctl`, ctlListener)
        },
        stop: () => ipcRenderer.send(`${channel}:ctl`, '[ABORT]'),
      }
    },

    listModels: (provider: string, baseUrl?: string, apiKey?: string) =>
      ipcRenderer.invoke('ai:listModels', provider, baseUrl, apiKey),

    testConnection: (options: { provider: string; apiKey?: string; baseUrl?: string }) =>
      ipcRenderer.invoke('ai:testConnection', options),
  },

  config: {
    get: () => ipcRenderer.invoke('config:get'),
    set: (key: string, value: unknown) => ipcRenderer.invoke('config:set', key, value),
  },

  chats: {
    load: () => ipcRenderer.invoke('chats:load'),
    save: (chats: unknown) => ipcRenderer.invoke('chats:save', chats),
    saveSync: (chats: unknown) => ipcRenderer.sendSync('chats:saveSync', chats),
  },

  tts: {
    synthesize: (text: string, voice?: string) => ipcRenderer.invoke('tts:synthesize', text, voice),
    voices: () => ipcRenderer.invoke('tts:voices'),
  },

  stt: {
    transcribe: (audioBase64: string, language?: string) => ipcRenderer.invoke('stt:transcribe', audioBase64, language),
  },

  clipboard: {
    read: () => ipcRenderer.invoke('clipboard:read'),
    write: (text: string) => ipcRenderer.invoke('clipboard:write', text),
  },

  web: {
    search: (query: string) => ipcRenderer.invoke('web:search', query),
    fetch: (url: string) => ipcRenderer.invoke('web:fetch', url),
  },

  mcp: {
    list: () => ipcRenderer.invoke('mcp:list'),
    getConfig: (id: string) => ipcRenderer.invoke('mcp:getConfig', id),
    listTools: (serverId?: string) => ipcRenderer.invoke('mcp:listTools', serverId),
    start: (id: string) => ipcRenderer.invoke('mcp:start', id),
    stop: (id: string) => ipcRenderer.invoke('mcp:stop', id),
    restart: (id: string) => ipcRenderer.invoke('mcp:restart', id),
    upsert: (server: {
      id: string
      name: string
      command: string
      args?: string[]
      env?: Record<string, string>
      cwd?: string
      enabled: boolean
      autoStart?: boolean
      description?: string
      requestTimeoutMs?: number
    }) => ipcRenderer.invoke('mcp:upsert', server),
    remove: (id: string) => ipcRenderer.invoke('mcp:remove', id),
    setEnabled: (id: string, enabled: boolean) => ipcRenderer.invoke('mcp:setEnabled', id, enabled),
    call: (fullName: string, args: Record<string, unknown>) => ipcRenderer.invoke('mcp:call', fullName, args),
    diagnostics: (id: string) => ipcRenderer.invoke('mcp:diagnostics', id),
    onChanged: (callback: (servers: unknown[]) => void) => {
      const listener = (_e: unknown, payload: unknown[]) => callback(payload)
      ipcRenderer.on('mcp:changed', listener)
      return () => ipcRenderer.removeListener('mcp:changed', listener)
    },
  },

  obsidian: {
    scan: () => ipcRenderer.invoke('obsidian:scan'),
    readNote: (id: string) => ipcRenderer.invoke('obsidian:readNote', id),
    pickVault: () => ipcRenderer.invoke('obsidian:pickVault'),
  },
})