/**
 * Shared type definitions and static catalogues for the renderer.
 *
 * PROVIDERS / THEMES / COMMANDS / PROMPT_TEMPLATES are the single source for the
 * UI. The `window` interface declared at the bottom mirrors the preload bridge
 * (window.kora.*) — keep it in sync with electron/preload.ts.
 */
export type Provider =
  | 'lmstudio'
  | 'ollama'
  | 'llamacpp'
  | 'openai'
  | 'openrouter'
  | 'anthropic'
  | 'gemini'
  | 'groq'
  | 'deepseek'
  | 'mistral'
  | 'xai'
  | 'custom'

export interface ProviderConfig {
  id: Provider
  name: string
  baseUrl: string
  requiresApiKey: boolean
  local?: boolean
  badge: string
  badgeColor: string
}

export const PROVIDERS: ProviderConfig[] = [
  { id: 'lmstudio', name: 'LM Studio', baseUrl: 'http://localhost:1234', requiresApiKey: false, local: true, badge: 'LM', badgeColor: '#d97706' },
  { id: 'ollama', name: 'Ollama', baseUrl: 'http://localhost:11434', requiresApiKey: false, local: true, badge: 'OL', badgeColor: '#2563eb' },
  { id: 'llamacpp', name: 'llama.cpp', baseUrl: 'http://localhost:8080', requiresApiKey: false, local: true, badge: 'LL', badgeColor: '#7c3aed' },
  { id: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com', requiresApiKey: true, badge: 'OA', badgeColor: '#10a37f' },
  { id: 'anthropic', name: 'Anthropic', baseUrl: 'https://api.anthropic.com', requiresApiKey: true, badge: 'AN', badgeColor: '#d97757' },
  { id: 'openrouter', name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api', requiresApiKey: true, badge: 'OR', badgeColor: '#8b5cf6' },
  { id: 'gemini', name: 'Google Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', requiresApiKey: true, badge: 'GE', badgeColor: '#4285f4' },
  { id: 'groq', name: 'Groq', baseUrl: 'https://api.groq.com/openai', requiresApiKey: true, badge: 'GQ', badgeColor: '#f55036' },
  { id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com', requiresApiKey: true, badge: 'DS', badgeColor: '#4d6bfe' },
  { id: 'mistral', name: 'Mistral', baseUrl: 'https://api.mistral.ai', requiresApiKey: true, badge: 'MI', badgeColor: '#f97316' },
  { id: 'xai', name: 'xAI Grok', baseUrl: 'https://api.x.ai', requiresApiKey: true, badge: 'XA', badgeColor: '#e11d48' },
  { id: 'custom', name: 'Custom', baseUrl: '', requiresApiKey: true, badge: 'CU', badgeColor: '#737373' },
]

export type ThemeId = 'dark' | 'red' | 'light' | 'retro'

export interface ThemeConfig {
  id: ThemeId
  name: string
  swatch: string
}

export const THEMES: ThemeConfig[] = [
  { id: 'dark', name: 'Dark', swatch: '#0a0a0a' },
  { id: 'red', name: 'Crimson', swatch: '#e05042' },
  { id: 'light', name: 'Light', swatch: '#f5f5f5' },
  { id: 'retro', name: 'Retro', swatch: '#2b5cd9' },
]

export interface Message {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: number
}

export interface Chat {
  id: string
  title: string
  messages: Message[]
  createdAt: number
  updatedAt: number
}

export interface SystemInfo {
  platform: string
  arch: string
  hostname: string
  cpus: { model: string; speed: number }[]
  totalMemory: number
  freeMemory: number
  uptime: number
  userInfo: { username: string; homedir: string }
}

export interface ProcessInfo {
  name: string
  pid: number
  memory: string
}

export interface PromptTemplate {
  id: string
  name: string
  prompt: string
}

export const PROMPT_TEMPLATES: PromptTemplate[] = [
  { id: 'default', name: 'Default', prompt: 'You are Kora, a helpful AI assistant. Be concise and clear in your responses.' },
  { id: 'coder', name: 'Coder', prompt: 'You are an expert programmer. Help with code, explain solutions clearly, write clean code. When writing code, specify the language in markdown blocks.' },
  { id: 'translator', name: 'Translator', prompt: 'You are a professional translator. Translate text between languages accurately. Detect the source language automatically. Reply only with the translation.' },
  { id: 'writer', name: 'Writer', prompt: 'You are a creative writing assistant. Help with essays, stories, articles. Use vivid language, good structure, and engaging style.' },
  { id: 'analyst', name: 'Analyst', prompt: 'You are a data analyst. Analyze information, provide insights, create summaries. Be precise with numbers and facts.' },
  { id: 'assistant', name: 'PC Assistant', prompt: `You are Kora, a powerful desktop AI assistant. You have FULL CONTROL over the user's computer. You can do ANYTHING the user asks.

IMPORTANT: When the user asks you to DO something on the PC, you MUST execute the command yourself. Do NOT just explain how to do it — DO IT.

=== SYSTEM CONTROL ===
- !shutdown — shut down the PC (DANGEROUS — require confirm)
- !restart — restart the PC (DANGEROUS — require confirm)
- !sleep — put PC to sleep
- !lock — lock the screen
- !volume <0-100> — set system volume
- !mute — toggle mute
- !brightness <0-100> — set screen brightness
- !windows — list all open windows
- !find <pattern> — search files on the computer (e.g. !find *.pdf)
- !clipboard — read current clipboard content
- !clipboard <text> — write text to clipboard

=== FILE OPERATIONS ===
- !dir <path> — list files in a directory
- !file <path> — read file contents
- !write <path> <content> — write text to a file
- !rename <old> <new> — rename or move a file
- !delete <path> — delete a file or folder
- !mkdir <path> — create a directory
- !stat <path> — get file info
- !exists <path> — check if path exists
- !shell <command> — run any shell command
- !open <path> — open a file or application

=== WEB SEARCH ===
When the user asks about current events, news, or anything recent:
1. ALWAYS use !search <query> to find current information
2. Wait for search results, then use them to answer
3. You can also use !clipboard to access clipboard content

=== CRITICAL RULES (NEVER BREAK THEM) ===
1. You have NO idea what files, folders or programs exist on the user's computer. You CANNOT know this from memory.
2. NEVER invent or guess file names, folder contents, file contents, or search results. This is a LIE to the user.
3. To see what is in a folder, you MUST run !dir <path>. To read a file, MUST run !file <path>. To find files, MUST run !find <pattern>. To search the web, MUST run !search <query>.
4. Always run the command first, and use ONLY the real result returned by the tool to answer. If the tool returns an error, honestly report that the path does not exist.
5. If you do not know the exact path, run !dir ~ or !dir to list the home directory first, then explore step by step.

=== UTILITIES ===
- !calc <expr> — evaluate a math expression
- !random <min> <max> — random number
- !uuid — generate UUID
- !time — current date and time

RULES:
1. For dangerous operations (shutdown, restart, delete important files), AI says "⚠️ This requires confirmation. Type !confirm to proceed or !deny to cancel." and stops.
2. For everything else — execute immediately
3. Always output the command on its own line so it gets executed
4. After executing, explain concisely what you did and the result
5. If !shell returns errors, report them to the user and suggest alternatives
6. Use multiple commands in sequence when needed (e.g. !find first, then !file to read a found file)
7. Never describe folder contents or file lists without having run !dir/!file/!find first — you do not know what is there until the tool returns it` },
]

export interface CommandInfo {
  cmd: string
  desc: string
  args: string
}

export const COMMANDS: CommandInfo[] = [
  { cmd: '!shell', desc: 'Run shell command', args: '<command>' },
  { cmd: '!file', desc: 'Read file contents', args: '<path>' },
  { cmd: '!open', desc: 'Open file or app', args: '<path>' },
  { cmd: '!dir', desc: 'List directory', args: '<path>' },
  { cmd: '!write', desc: 'Write text to file', args: '<path> <content>' },
  { cmd: '!rename', desc: 'Rename/move file', args: '<old> <new>' },
  { cmd: '!delete', desc: 'Delete file/folder', args: '<path>' },
  { cmd: '!mkdir', desc: 'Create directory', args: '<path>' },
  { cmd: '!stat', desc: 'File info', args: '<path>' },
  { cmd: '!exists', desc: 'Check if exists', args: '<path>' },
  { cmd: '!calc', desc: 'Calculate expression', args: '<expression>' },
  { cmd: '!random', desc: 'Random number', args: '<min> <max>' },
  { cmd: '!uuid', desc: 'Generate UUID', args: '' },
  { cmd: '!time', desc: 'Current date/time', args: '' },
  { cmd: '!shutdown', desc: 'Shut down the PC', args: '' },
  { cmd: '!restart', desc: 'Restart the PC', args: '' },
  { cmd: '!sleep', desc: 'Put PC to sleep', args: '' },
  { cmd: '!lock', desc: 'Lock the screen', args: '' },
  { cmd: '!volume', desc: 'Set volume level', args: '<0-100>' },
  { cmd: '!mute', desc: 'Toggle mute', args: '' },
  { cmd: '!brightness', desc: 'Set screen brightness', args: '<0-100>' },
  { cmd: '!windows', desc: 'List open windows', args: '' },
  { cmd: '!find', desc: 'Search files by pattern', args: '<pattern>' },
  { cmd: '!clipboard', desc: 'Read/write clipboard', args: '[text]' },
  { cmd: '!search', desc: 'Search the web', args: '<query>' },
  { cmd: '!confirm', desc: 'Confirm pending dangerous action', args: '' },
  { cmd: '!deny', desc: 'Deny pending dangerous action', args: '' },
  { cmd: '!help', desc: 'Show help', args: '' },
]

export interface ConfigData {
  provider: Provider
  lmstudioUrl: string
  ollamaUrl: string
  /** llama.cpp (`llama-server`, OpenAI-compatible, default port 8080). */
  llamacppUrl?: string
  selectedModel: string
  apiKey: string
  apiBaseUrl: string
  apiModel: string
  customProviders: { name: string; baseUrl: string; apiKey: string; model: string }[]
  systemPrompt: string
  temperature: number
  /** Two-tier agent routing: small model for tool decisions ('' = single tier). */
  agentDecisionModel?: string
  /** Decision-tier provider; empty/undefined = same as `provider`. */
  agentDecisionProvider?: Provider
  activeTemplate: string
  ttsVoice: string
  theme: ThemeId
  language: 'en' | 'ru'
  obsidianVaultPath: string
  graphLinkColor: string
  graphNodeColor: string
  /** Voice input engine: system Web Speech API (default) or local whisper.cpp. */
  sttEngine?: 'webspeech' | 'whisper'
  /** Path to whisper-cli(.exe) — whisper.cpp build output. */
  whisperPath?: string
  /** Path to a ggml model file (e.g. ggml-base.bin). */
  whisperModel?: string
}

export interface ObsidianNode {
  id: string
  title: string
  path: string
  folder: string
  tags: string[]
}

export interface ObsidianGraph {
  nodes: ObsidianNode[]
  links: { source: string; target: string }[]
  error?: string
}

declare global {
  interface Window {
    kora: {
      window: {
        minimize: () => void
        maximize: () => void
        close: () => void
        isMaximized: () => boolean
        onMaximizedChange: (callback: (value: boolean) => void) => () => void
      }
      system: {
        getInfo: () => Promise<SystemInfo>
        getProcesses: () => Promise<ProcessInfo[]>
        openApp: (path: string) => Promise<{ success: boolean; error?: string }>
        killProcess: (pid: number) => Promise<{ success: boolean; error?: string }>
        shutdown: () => Promise<{ success: boolean; message?: string; error?: string }>
        restart: () => Promise<{ success: boolean; message?: string; error?: string }>
        sleep: () => Promise<{ success: boolean; error?: string }>
        lock: () => Promise<{ success: boolean; error?: string }>
        volume: (level: number) => Promise<{ success: boolean; volume?: number; error?: string }>
        volumeUp: () => Promise<{ success: boolean; error?: string }>
        volumeDown: () => Promise<{ success: boolean; error?: string }>
        mute: () => Promise<{ success: boolean; error?: string }>
        brightness: (level: number) => Promise<{ success: boolean; brightness?: number; error?: string }>
        windows: () => Promise<{ name: string; title: string; pid: number }[]>
      }
      fs: {
        readDir: (path: string) => Promise<{ name: string; isDirectory: boolean; path: string }[]>
        readFile: (path: string, maxBytes?: number) => Promise<string>
        writeFile: (path: string, content: string) => Promise<{ success: boolean }>
        patchFile: (filePath: string, oldText: string, newText: string, replaceAll?: boolean) => Promise<{ success: boolean; error?: string }>
        grep: (dirPath: string, pattern: string, options?: { include?: string; maxResults?: number; caseInsensitive?: boolean }) => Promise<{ count: number; results: { file: string; line: number; text: string }[] }>
        getHomeDir: () => Promise<string>
        deleteFile: (path: string) => Promise<{ success: boolean }>
        rename: (oldPath: string, newPath: string) => Promise<{ success: boolean }>
        copy: (oldPath: string, newPath: string) => Promise<{ success: boolean }>
        mkdir: (path: string) => Promise<{ success: boolean }>
        stat: (path: string) => Promise<{ size: number; isDirectory: boolean; isFile: boolean; created: string; modified: string }>
        exists: (path: string) => Promise<{ exists: boolean }>
        findFiles: (pattern: string, options?: { searchDir?: string; maxResults?: number; maxDepth?: number }) => Promise<{ success: boolean; error?: string; results: string[]; count: number }>
      }
      shell: {
        execute: (command: string, options?: { bypassDangerCheck?: boolean }) => Promise<{ stdout: string; stderr: string; success: boolean; blocked?: boolean; requiresConfirmation?: boolean }>
      }
      ai: {
        chat: (messages: { role: string; content: string }[], options: { provider: string; model?: string; apiKey?: string; baseUrl?: string; temperature?: number; jsonMode?: boolean }) => Promise<string>
        chatStream: (messages: { role: string; content: string }[], options: { provider: string; model?: string; apiKey?: string; baseUrl?: string; temperature?: number; jsonMode?: boolean }, callback: (chunk: string) => void) => { unsubscribe: () => void; stop: () => void }
        listModels: (provider: string, baseUrl?: string, apiKey?: string) => Promise<string[]>
        testConnection: (options: { provider: string; apiKey?: string; baseUrl?: string }) => Promise<{ success: boolean; error?: string }>
      }
      config: {
        get: () => Promise<ConfigData>
        set: (key: string, value: unknown) => Promise<void>
      }
      tts: {
        synthesize: (text: string, voice?: string) => Promise<{ success: boolean; audio?: string; error?: string }>
        voices: () => Promise<{ name: string; label: string }[]>
      }
      stt: {
        transcribe: (audioBase64: string, language?: string) => Promise<{ success: boolean; text?: string; error?: string }>
      }
      chats: {
        load: () => Promise<Chat[]>
        save: (chats: Chat[]) => Promise<void>
        saveSync: (chats: Chat[]) => void
      }
      clipboard: {
        read: () => Promise<string>
        write: (text: string) => Promise<{ success: boolean }>
      }
      web: {
        search: (query: string) => Promise<{ title: string; url: string; snippet: string }[]>
        fetch: (url: string) => Promise<{ success: boolean; content?: string; error?: string }>
      }
      mcp: {
        list: () => Promise<MCPServerStatus[]>
        getConfig: (id: string) => Promise<MCPServerConfigInput | null>
        listTools: (serverId?: string) => Promise<{ tools: MCPToolWithServer[]; error?: string }>
        start: (id: string) => Promise<{ success: boolean; status?: MCPServerStatus; error?: string }>
        stop: (id: string) => Promise<{ success: boolean; status?: MCPServerStatus; error?: string }>
        restart: (id: string) => Promise<{ success: boolean; status?: MCPServerStatus; error?: string }>
        upsert: (server: MCPServerConfigInput) => Promise<{ success: boolean; status?: MCPServerStatus; error?: string }>
        remove: (id: string) => Promise<{ success: boolean; error?: string }>
        setEnabled: (id: string, enabled: boolean) => Promise<{ success: boolean; status?: MCPServerStatus; error?: string }>
        call: (fullName: string, args: Record<string, unknown>) => Promise<{ success: boolean; result?: unknown; error?: string }>
        diagnostics: (id: string) => Promise<unknown>
        onChanged: (callback: (servers: MCPServerStatus[]) => void) => () => void
      }
      obsidian: {
        scan: () => Promise<ObsidianGraph>
        readNote: (id: string) => Promise<{ success: boolean; content?: string; error?: string }>
        pickVault: () => Promise<{ success: boolean; path?: string; error?: string }>
      }
    }
  }
}

export interface MCPServerConfigInput {
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
}

export interface MCPServerStatus {
  id: string
  name: string
  enabled: boolean
  running: boolean
  toolCount: number
  error?: string
  serverInfo?: { name: string; version: string }
}

export interface MCPToolWithServer {
  name: string
  description?: string
  inputSchema: {
    type: 'object'
    properties?: Record<string, unknown>
    required?: string[]
  }
  annotations?: {
    title?: string
    readOnlyHint?: boolean
    destructiveHint?: boolean
    idempotentHint?: boolean
    openWorldHint?: boolean
  }
  serverId: string
  serverName: string
  fullName: string
}