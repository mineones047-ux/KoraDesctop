/**
 * Browser-only preview harness (dev use): installs a mock `window.kora` bridge, then
 * mounts the real renderer so the UI can be inspected in a normal browser tab.
 * Not referenced by `index.html`, so it is absent from production builds.
 */
import type { Chat, ConfigData } from './types'

const now = Date.now()
const HOUR = 3600_000
const DAY = 24 * HOUR

const sampleChats: Chat[] = [
  {
    id: 'c1',
    title: 'Refactor the auth middleware',
    pinned: true,
    createdAt: now - 2 * HOUR,
    updatedAt: now - HOUR,
    messages: [
      { id: 'm1', role: 'user', content: 'Can you review this Express auth middleware and tell me what is risky?', timestamp: now - 2 * HOUR },
      {
        id: 'm2',
        role: 'assistant',
        content: 'Here is what stands out:\n\n1. **Timing attack** — the token comparison uses `===`. Use `crypto.timingSafeEqual`.\n2. **No expiry check** — `payload.exp` is never compared to the current time.\n3. **Silent failure** — every error returns 401, so a misconfigured secret looks like a bad password.\n\n```ts\nconst ok = crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected))\nif (!ok || payload.exp * 1000 < Date.now()) return res.status(401).end()\n```\n\nWant me to patch it?',
        timestamp: now - HOUR,
      },
      { id: 'm3', role: 'user', content: 'Yes, show me the patch.', timestamp: now - HOUR / 2 },
      { id: 'm4', role: 'assistant', content: 'Applying the change to `src/auth.ts`:\n\n- swap the comparison for a timing-safe one\n- reject expired tokens first\n- log the failure reason server-side only\n\nThis keeps the public response identical for both cases, which is what you want.', timestamp: now - 20 * 60_000 },
    ],
  },
  {
    id: 'c2',
    title: 'Obsidian vault structure',
    createdAt: now - DAY,
    updatedAt: now - DAY,
    messages: [{ id: 'm5', role: 'user', content: 'How should I organize my notes?', timestamp: now - DAY }],
  },
  {
    id: 'c3',
    title: 'Regex for log timestamps',
    createdAt: now - 3 * DAY,
    updatedAt: now - 3 * DAY,
    messages: [{ id: 'm6', role: 'user', content: 'Write a regex for ISO timestamps.', timestamp: now - 3 * DAY }],
  },
  {
    id: 'c4',
    title: 'Private brainstorming',
    ephemeral: true,
    createdAt: now - 5 * DAY,
    updatedAt: now - 5 * DAY,
    messages: [{ id: 'm7', role: 'user', content: 'Ideas for a desktop assistant.', timestamp: now - 5 * DAY }],
  },
  {
    id: 'c5',
    title: 'Llama.cpp setup notes',
    createdAt: now - 40 * DAY,
    updatedAt: now - 40 * DAY,
    messages: [{ id: 'm8', role: 'user', content: 'Which quant should I use?', timestamp: now - 40 * DAY }],
  },
]

const config: ConfigData = {
  provider: 'lmstudio',
  lmstudioUrl: 'http://localhost:1234',
  ollamaUrl: 'http://localhost:11434',
  selectedModel: 'qwen2.5-7b-instruct',
  apiKey: '',
  apiBaseUrl: 'https://api.openai.com',
  apiModel: 'gpt-3.5-turbo',
  customProviders: [],
  systemPrompt: 'You are Kora.',
  temperature: 0.7,
  activeTemplate: 'default',
  ttsVoice: 'en-US-AriaNeural',
  theme: 'dark',
  language: 'en',
  obsidianVaultPath: '',
  graphLinkColor: '',
  graphNodeColor: '',
  savedPrompts: [
    { id: 'p1', title: 'Code review', prompt: 'Review this code for correctness, security and readability. Be specific:\n\n' },
    { id: 'p2', title: 'Commit message', prompt: 'Write a concise conventional commit message for these changes:\n\n' },
  ],
}

let chats = sampleChats

const replyText =
  'Sure — here is the short version.\n\n- The composer now estimates context as you type.\n- Pinned chats stay at the top.\n- Private chats never touch the disk.\n\n```ts\nconst total = messages.reduce((sum, m) => sum + m.content.length, 0)\n```'

const bridge = {
  window: {
    minimize: () => {},
    maximize: () => {},
    close: () => {},
    isMaximized: () => false,
    onMaximizedChange: () => () => {},
  },
  system: {
    getInfo: async () => ({
      platform: 'win32', arch: 'x64', hostname: 'preview',
      cpus: [{ model: 'Preview CPU', speed: 3200 }],
      totalMemory: 32 * 1024 ** 3, freeMemory: 18 * 1024 ** 3, uptime: 3600,
      userInfo: { username: 'preview', homedir: 'C:/Users/preview' },
    }),
    getProcesses: async () => [],
    openApp: async () => ({ success: true }),
    killProcess: async () => ({ success: true }),
    shutdown: async () => ({ success: true }),
    restart: async () => ({ success: true }),
    sleep: async () => ({ success: true }),
    lock: async () => ({ success: true }),
    volume: async () => ({ success: true }),
    volumeUp: async () => ({ success: true }),
    volumeDown: async () => ({ success: true }),
    mute: async () => ({ success: true }),
    brightness: async () => ({ success: true }),
    windows: async () => [],
  },
  fs: {
    readDir: async () => [],
    readFile: async () => '',
    writeFile: async () => ({ success: true }),
    patchFile: async () => ({ success: true }),
    grep: async () => ({ count: 0, results: [] }),
    getHomeDir: async () => 'C:/Users/preview',
    deleteFile: async () => ({ success: true }),
    rename: async () => ({ success: true }),
    copy: async () => ({ success: true }),
    mkdir: async () => ({ success: true }),
    stat: async () => ({ size: 0, isDirectory: false, isFile: true, created: '', modified: '' }),
    exists: async () => ({ exists: false }),
    findFiles: async () => ({ success: true, results: [], count: 0 }),
    installSkill: async () => ({ success: false, error: 'preview' }),
  },
  shell: { execute: async () => ({ stdout: '', stderr: '', success: true }) },
  ai: {
    chat: async () => 'preview',
    chatStream: (_messages: unknown, _options: unknown, callback: (chunk: string) => void) => {
      let stopped = false
      let index = 0
      const timer = setInterval(() => {
        if (stopped) return
        const next = Math.min(index + 6, replyText.length)
        callback(replyText.slice(index, next))
        index = next
        if (index >= replyText.length) {
          clearInterval(timer)
          callback('[DONE]')
        }
      }, 30)
      return {
        unsubscribe: () => clearInterval(timer),
        stop: () => {
          stopped = true
          clearInterval(timer)
        },
      }
    },
    listModels: async () => ['qwen2.5-7b-instruct', 'llama-3.2-3b-instruct'],
    testConnection: async () => ({ success: true }),
  },
  config: {
    get: async () => config,
    set: async (key: string, value: unknown) => {
      ;(config as unknown as Record<string, unknown>)[key] = value
    },
  },
  tts: { synthesize: async () => ({ success: false }), voices: async () => [] },
  stt: { transcribe: async () => ({ success: false }) },
  chats: {
    load: async () => chats,
    save: async (next: Chat[]) => { chats = next },
    saveSync: (next: Chat[]) => { chats = next },
  },
  clipboard: { read: async () => '', write: async () => ({ success: true }) },
  web: { search: async () => [], fetch: async () => ({ success: false }) },
  mcp: {
    list: async () => [],
    getConfig: async () => null,
    listTools: async () => ({ tools: [] }),
    start: async () => ({ success: true }),
    stop: async () => ({ success: true }),
    restart: async () => ({ success: true }),
    upsert: async () => ({ success: true }),
    remove: async () => ({ success: true }),
    setEnabled: async () => ({ success: true }),
    call: async () => ({ success: true }),
    diagnostics: async () => ({}),
    install: async () => ({ success: true }),
    onChanged: () => () => {},
  },
  obsidian: {
    scan: async () => ({ nodes: [], links: [] }),
    readNote: async () => ({ success: false }),
    pickVault: async () => ({ success: false }),
  },
  localAI: {
    profile: async () => ({ profile: { ramGb: 32, cpuCores: 12, vramGb: 8 }, recommendation: { maxParamsB: 7, quant: 'Q4_K_M' } }),
    search: async () => ({ success: true, models: [] }),
    files: async () => ({ success: true, files: [] }),
    downloadStt: async () => ({ success: true }),
    scanDisks: async () => ({ success: true, found: [] }),
    startExternal: async () => ({ success: true }),
    download: async () => ({ success: true }),
    cancel: async () => ({ success: true }),
    pause: async () => ({ success: true }),
    partials: async () => ({ success: true, partials: [] }),
    list: async () => ({ success: true, models: [] }),
    remove: async () => ({ success: true }),
    engineStatus: async () => ({ success: true, status: { installed: false, binaryPath: null, running: false, external: false, port: null, pid: null, modelPath: null } }),
    downloadEngine: async () => ({ success: true }),
    start: async () => ({ success: true }),
    stop: async () => ({ success: true }),
    onProgress: () => () => {},
  },
  app: { setAutoLaunch: async () => ({ success: true }) },
}

;(window as unknown as { kora: unknown }).kora = bridge

void import('./main')
