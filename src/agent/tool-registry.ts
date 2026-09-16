import { ToolId, ToolMetadata, ParameterDefinition, isMcpToolId, BuiltinToolId } from './planner'
import type { MCPToolWithServer } from '../types'
import { boundToolError } from './guards'
import { resolveProviderConfig } from '../lib/resolve-provider'
import { validatePath } from '../lib/path-security'

export type { ToolId, BuiltinToolId, ToolMetadata, ParameterDefinition } from './planner'

// Define all available tools with their metadata
export const BUILTIN_TOOL_METADATA: Record<BuiltinToolId, ToolMetadata> = {
  shell: {
    id: 'shell',
    name: 'Shell Execution',
    description: 'Execute shell commands on the system',
    requiresConfirmation: true,
    parameters: [
      { name: 'command', type: 'string', required: true, description: 'The shell command to execute' },
    ],
  },
  file: {
    id: 'file',
    name: 'File Operations',
    description: 'Read, write, delete, and manage files',
    requiresConfirmation: true,
    parameters: [
      { name: 'operation', type: 'string', required: true, description: 'File operation: read, write, delete, mkdir, rename, copy, exists, stat, list' },
      { name: 'path', type: 'string', required: true, description: 'File or directory path' },
      { name: 'content', type: 'string', required: false, description: 'Content to write (for write operation)' },
      { name: 'oldPath', type: 'string', required: false, description: 'Source path (for rename/copy operations)' },
      { name: 'newPath', type: 'string', required: false, description: 'Destination path (for rename/copy operations)' },
    ],
  },
  patch_file: {
    id: 'patch_file',
    name: 'Patch File',
    description: 'Apply a precise text replacement in a file (oldText must match exactly once unless replaceAll=true). Use this instead of write_file when editing existing code.',
    requiresConfirmation: true,
    parameters: [
      { name: 'path', type: 'string', required: true, description: 'File path to patch' },
      { name: 'oldText', type: 'string', required: true, description: 'Exact text to find (must be unique in file)' },
      { name: 'newText', type: 'string', required: true, description: 'Replacement text' },
      { name: 'replaceAll', type: 'boolean', required: false, description: 'Replace all occurrences (default false)' },
    ],
  },
  grep: {
    id: 'grep',
    name: 'Grep / Search',
    description: 'Search for a regex pattern across files in a directory. Skips node_modules and hidden folders.',
    requiresConfirmation: false,
    parameters: [
      { name: 'path', type: 'string', required: true, description: 'Directory to search in' },
      { name: 'pattern', type: 'string', required: true, description: 'Regex pattern to search for' },
      { name: 'include', type: 'string', required: false, description: 'Glob filter for filenames, e.g. *.ts' },
      { name: 'maxResults', type: 'number', required: false, description: 'Max results to return (default 100)' },
    ],
  },
  open: {
    id: 'open',
    name: 'Open Application/File',
    description: 'Open an application or file',
    requiresConfirmation: true,
    parameters: [
      { name: 'path', type: 'string', required: true, description: 'Path to application or file' },
    ],
  },
  dir: {
    id: 'dir',
    name: 'Directory Listing',
    description: 'List files in a directory',
    requiresConfirmation: false,
    parameters: [
      { name: 'path', type: 'string', required: false, description: 'Directory path (defaults to home)' },
    ],
  },
  write: {
    id: 'write',
    name: 'Write to File',
    description: 'Write content to a file',
    requiresConfirmation: true,
    parameters: [
      { name: 'path', type: 'string', required: true, description: 'File path to write to' },
      { name: 'content', type: 'string', required: true, description: 'Content to write' },
    ],
  },
  rename: {
    id: 'rename',
    name: 'Rename/Move File',
    description: 'Rename or move a file/directory',
    requiresConfirmation: true,
    parameters: [
      { name: 'oldPath', type: 'string', required: true, description: 'Current path' },
      { name: 'newPath', type: 'string', required: true, description: 'New path' },
    ],
  },
  delete: {
    id: 'delete',
    name: 'Delete File/Folder',
    description: 'Delete a file or directory',
    requiresConfirmation: true,
    parameters: [
      { name: 'path', type: 'string', required: true, description: 'Path to delete' },
    ],
  },
  mkdir: {
    id: 'mkdir',
    name: 'Make Directory',
    description: 'Create a new directory',
    requiresConfirmation: true,
    parameters: [
      { name: 'path', type: 'string', required: true, description: 'Directory path to create' },
    ],
  },
  stat: {
    id: 'stat',
    name: 'File/Directory Info',
    description: 'Get file/directory information (size, created, modified)',
    requiresConfirmation: false,
    parameters: [
      { name: 'path', type: 'string', required: true, description: 'Path to get info for' },
    ],
  },
  exists: {
    id: 'exists',
    name: 'Check if Exists',
    description: 'Check if a path exists',
    requiresConfirmation: false,
    parameters: [
      { name: 'path', type: 'string', required: true, description: 'Path to check' },
    ],
  },
  help: {
    id: 'help',
    name: 'Show Help',
    description: 'Show available commands and help information',
    requiresConfirmation: false,
    parameters: [],
  },
  volume: {
    id: 'volume',
    name: 'Set Volume',
    description: 'Set system volume level',
    requiresConfirmation: false,
    parameters: [
      { name: 'level', type: 'number', required: true, description: 'Volume level 0-100' },
    ],
  },
  mute: {
    id: 'mute',
    name: 'Toggle Mute',
    description: 'Toggle system mute',
    requiresConfirmation: false,
    parameters: [],
  },
  brightness: {
    id: 'brightness',
    name: 'Set Brightness',
    description: 'Set screen brightness level',
    requiresConfirmation: false,
    parameters: [
      { name: 'level', type: 'number', required: true, description: 'Brightness level 0-100' },
    ],
  },
  windows: {
    id: 'windows',
    name: 'List Windows',
    description: 'List all open windows',
    requiresConfirmation: false,
    parameters: [],
  },
  shutdown: {
    id: 'shutdown',
    name: 'Shut Down PC',
    description: 'Shut down the computer',
    requiresConfirmation: true,
    parameters: [],
  },
  restart: {
    id: 'restart',
    name: 'Restart PC',
    description: 'Restart the computer',
    requiresConfirmation: true,
    parameters: [],
  },
  sleep: {
    id: 'sleep',
    name: 'Sleep',
    description: 'Put computer to sleep',
    requiresConfirmation: true,
    parameters: [],
  },
  lock: {
    id: 'lock',
    name: 'Lock Screen',
    description: 'Lock the screen',
    requiresConfirmation: true,
    parameters: [],
  },
  search: {
    id: 'search',
    name: 'Web Search',
    description: 'Search the web for information',
    requiresConfirmation: false,
    parameters: [
      { name: 'query', type: 'string', required: true, description: 'Search query' },
    ],
  },
  clipboard: {
    id: 'clipboard',
    name: 'Clipboard Operations',
    description: 'Read from or write to system clipboard',
    requiresConfirmation: true,
    parameters: [
      { name: 'action', type: 'string', required: true, description: 'Action: read or write' },
      { name: 'text', type: 'string', required: false, description: 'Text to write (for write action)' },
    ],
  },
  ai_chat: {
    id: 'ai_chat',
    name: 'AI Chat',
    description: 'Chat with AI assistant',
    requiresConfirmation: false,
    parameters: [
      { name: 'message', type: 'string', required: true, description: 'User message' },
    ],
  },
  ai_list_models: {
    id: 'ai_list_models',
    name: 'List Models',
    description: 'List available AI models for the selected provider',
    requiresConfirmation: false,
    parameters: [],
  },
  ai_test_connection: {
    id: 'ai_test_connection',
    name: 'Test Connection',
    description: 'Test AI provider connection',
    requiresConfirmation: false,
    parameters: [],
  },
  tts_synthesize: {
    id: 'tts_synthesize',
    name: 'Text-to-Speech',
    description: 'Synthesize speech from text',
    requiresConfirmation: false,
    parameters: [
      { name: 'text', type: 'string', required: true, description: 'Text to synthesize' },
      { name: 'voice', type: 'string', required: false, description: 'Voice ID' },
    ],
  },
  tts_voices: {
    id: 'tts_voices',
    name: 'List TTS Voices',
    description: 'List available TTS voices',
    requiresConfirmation: false,
    parameters: [],
  },
}

// MCP tool metadata (separate from built-in to allow dynamic updates)
const MCP_TOOL_METADATA = new Map<string, ToolMetadata>()

export function getAllToolMetadata(): Record<string, ToolMetadata> {
  return { ...BUILTIN_TOOL_METADATA, ...Object.fromEntries(MCP_TOOL_METADATA) }
}

function setMcpTools(tools: MCPToolWithServer[]) {
  MCP_TOOL_METADATA.clear()
  for (const t of tools) {
    MCP_TOOL_METADATA.set(t.fullName, jsonSchemaToMetadata(t))
  }
}

function jsonSchemaToMetadata(t: MCPToolWithServer): ToolMetadata {
  const properties = t.inputSchema?.properties ?? {}
  const required = new Set(t.inputSchema?.required ?? [])
  const parameters: ParameterDefinition[] = Object.entries(properties).map(([name, schemaRaw]) => {
    const schema = (schemaRaw ?? {}) as Record<string, unknown>
    const typeStr = typeof schema.type === 'string' ? schema.type : 'string'
    const type: ParameterDefinition['type'] =
      typeStr === 'number' || typeStr === 'integer' ? 'number' : typeStr === 'boolean' ? 'boolean' : 'string'
    const desc = typeof schema.description === 'string' ? schema.description : ''
    return {
      name,
      type,
      required: required.has(name),
      description: desc,
    }
  })
  return {
    id: t.fullName as ToolId,
    name: `${t.serverName}: ${t.name}`,
    description: t.description ?? '',
    requiresConfirmation: t.annotations?.destructiveHint === true,
    parameters,
  }
}

function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' && v.length > 0 ? v : fallback
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && !isNaN(v) ? v : fallback
}

interface DirEntry {
  name: string
  isDirectory: boolean
  path: string
}

type ToolHandler = (
  params: Record<string, unknown>,
  opts: { approved?: boolean },
  registry: ToolRegistry,
) => Promise<unknown>

const handlers: Record<string, ToolHandler> = {
  shell: async (params, opts) => {
    const cmd = str(params.command)
    const result = await window.kora.shell.execute(cmd, { bypassDangerCheck: opts.approved === true })
    return {
      stdout: result.stdout || '',
      stderr: result.stderr || '',
      success: result.success,
      blocked: result.blocked || false,
    }
  },

  file: async (params) => {
    const operation = str(params.operation)
    const filePath = str(params.path)
    const needsValidation = ['write', 'delete', 'mkdir', 'rename', 'copy'].includes(operation)
    if (needsValidation) {
      const err = validatePath(filePath)
      if (err) return { success: false, error: `Security: ${err}` }
    }
    switch (operation) {
      case 'read': return window.kora.fs.readFile(filePath)
      case 'write': { await window.kora.fs.writeFile(filePath, str(params.content)); return { success: true } }
      case 'delete': { await window.kora.fs.deleteFile(filePath); return { success: true } }
      case 'mkdir': { await window.kora.fs.mkdir(filePath); return { success: true } }
      case 'rename': {
        const oldPath = str(params.oldPath, filePath)
        const newPath = str(params.newPath)
        if (!newPath) throw new Error('newPath is required for rename')
        const err = validatePath(newPath)
        if (err) return { success: false, error: `Security: ${err}` }
        await window.kora.fs.rename(oldPath, newPath)
        return { success: true }
      }
      case 'copy': {
        const srcPath = str(params.oldPath, filePath)
        const dstPath = str(params.newPath)
        if (!dstPath) throw new Error('newPath is required for copy')
        const err = validatePath(dstPath)
        if (err) return { success: false, error: `Security: ${err}` }
        await window.kora.fs.copy(srcPath, dstPath)
        return { success: true }
      }
      case 'exists': { const r = await window.kora.fs.exists(filePath); return { exists: r.exists } }
      case 'stat': {
        const s = await window.kora.fs.stat(filePath)
        return { size: s.size, isDirectory: s.isDirectory, isFile: s.isFile, created: s.created, modified: s.modified }
      }
      case 'list': {
        const entries = await window.kora.fs.readDir(filePath)
        return entries.map((e: DirEntry) => ({ name: e.name, isDirectory: e.isDirectory, path: e.path }))
      }
      default: throw new Error(`Unknown file operation: ${operation}`)
    }
  },

  patch_file: async (params) => {
    const filePath = str(params.path)
    const err = validatePath(filePath)
    if (err) return { success: false, error: `Security: ${err}` }
    const oldText = str(params.oldText)
    const newText = str(params.newText)
    if (!oldText) throw new Error('oldText is required for patch_file')
    return window.kora.fs.patchFile(filePath, oldText, newText, params.replaceAll === true)
  },

  grep: async (params) => {
    const dirPath = str(params.path, '.')
    const pattern = str(params.pattern)
    const include = typeof params.include === 'string' ? params.include : undefined
    return window.kora.fs.grep(dirPath, pattern, { include, maxResults: num(params.maxResults, 100) })
  },

  open: async (params) => window.kora.system.openApp(str(params.path)),

  dir: async (params) => {
    const entries = await window.kora.fs.readDir(str(params.path, '~'))
    return entries.map((e: DirEntry) => ({ name: e.name, isDirectory: e.isDirectory, path: e.path }))
  },

  volume: async (params) => window.kora.system.volume(Math.max(0, Math.min(100, num(params.level, 50)))),
  mute: async () => window.kora.system.mute(),
  brightness: async (params) => window.kora.system.brightness(Math.max(0, Math.min(100, num(params.level, 50)))),
  windows: async () => window.kora.system.windows(),
  shutdown: async () => window.kora.system.shutdown(),
  restart: async () => window.kora.system.restart(),
  sleep: async () => window.kora.system.sleep(),
  lock: async () => window.kora.system.lock(),

  search: async (params) => window.kora.web.search(str(params.query)),

  clipboard: async (params) => {
    const action = str(params.action)
    if (action === 'read') return window.kora.clipboard.read()
    if (action === 'write') return window.kora.clipboard.write(str(params.text))
    throw new Error('Unknown clipboard action')
  },

  ai_chat: async (params) => {
    const message = str(params.message)
    const cfg = await window.kora.config.get()
    const providerCfg = resolveProviderConfig(cfg, str(params.baseUrl), str(params.model))
    return window.kora.ai.chat([{ role: 'user', content: message }], providerCfg)
  },

  ai_list_models: async (params) => {
    return window.kora.ai.listModels(str(params.provider, 'lmstudio'), str(params.baseUrl, 'http://localhost:1234'), str(params.apiKey))
  },

  ai_test_connection: async (params) => {
    return window.kora.ai.testConnection({ provider: str(params.provider, 'lmstudio'), apiKey: str(params.apiKey), baseUrl: str(params.baseUrl, 'http://localhost:1234') })
  },

  tts_synthesize: async (params) => window.kora.tts.synthesize(str(params.text), str(params.voice, 'ru-RU-DmitryNeural')),
  tts_voices: async () => window.kora.tts.voices(),

  help: async (_params, _opts, registry) => ({
    tools: registry.listMetadata().map((m) => ({ id: m.id, name: m.name, description: m.description })),
  }),
}

const TOOL_HANDLERS = handlers as Record<BuiltinToolId, ToolHandler>

// Tool execution using existing Kora IPC handlers via window.kora
export class ToolRegistry {
  private mcpRefreshInflight: Promise<void> | null = null
  private cachedTools: MCPToolWithServer[] = []

  getMetadata(tool: string): ToolMetadata | undefined {
    return BUILTIN_TOOL_METADATA[tool as BuiltinToolId] ?? MCP_TOOL_METADATA.get(tool)
  }

  listMetadata(): ToolMetadata[] {
    return [...Object.values(BUILTIN_TOOL_METADATA), ...MCP_TOOL_METADATA.values()]
  }

  async refreshMcpTools(): Promise<MCPToolWithServer[]> {
    if (this.mcpRefreshInflight) {
      await this.mcpRefreshInflight
      return this.cachedTools
    }
    this.mcpRefreshInflight = (async () => {
      const result = await window.kora.mcp.listTools()
      this.cachedTools = result.tools ?? []
      setMcpTools(this.cachedTools)
    })()
    try {
      await this.mcpRefreshInflight
    } finally {
      this.mcpRefreshInflight = null
    }
    return this.cachedTools
  }

  async execute(
    tool: ToolId,
    parameters: Record<string, unknown>,
    opts: { approved?: boolean } = {},
  ): Promise<unknown> {
    if (isMcpToolId(tool)) {
      return this.executeMcp(tool, parameters, opts)
    }

    const metadata = BUILTIN_TOOL_METADATA[tool as BuiltinToolId]
    if (!metadata) {
      throw new Error(`Unknown tool: ${tool}`)
    }

    if (metadata.requiresConfirmation && !opts.approved) {
      return { status: 'pending_confirmation', tool, parameters }
    }

    try {
      const handler = TOOL_HANDLERS[tool as BuiltinToolId]
      if (!handler) throw new Error(`Tool execution not implemented for: ${tool}`)
      return await handler(parameters, opts, this)
    } catch (error: unknown) {
      console.error(`Tool ${tool} execution error:`, error)
      return { success: false, error: boundToolError((error as Error)?.message ?? error) }
    }
  }

  private async executeMcp(
    tool: `mcp__${string}__${string}`,
    parameters: Record<string, unknown>,
    opts: { approved?: boolean } = {},
  ): Promise<unknown> {
    const metadata = MCP_TOOL_METADATA.get(tool)
    if (!metadata) {
      // Lazy refresh once if we don't know about this tool yet
      await this.refreshMcpTools()
    }
    const m = MCP_TOOL_METADATA.get(tool)
    if (!m) {
      // Unknown tool: never execute blindly, it may be destructive
      throw new Error(`Unknown MCP tool: ${tool}. It is not present on any running server.`)
    }
    if (m.requiresConfirmation && !opts.approved) {
      return { status: 'pending_confirmation', tool, parameters }
    }
    const result = await window.kora.mcp.call(tool, parameters ?? {})
    if (!result.success) {
      return { success: false, error: boundToolError(result.error) }
    }
    return result.result
  }
}

export const agentRegistry = new ToolRegistry()