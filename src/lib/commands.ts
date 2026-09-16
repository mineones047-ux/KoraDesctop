import type { Translations } from '../i18n/en'
import type { MutableRefObject } from 'react'
import { validatePath } from './path-security'

export interface PendingAction {
  type: string
  args: string[]
  description: string
}

export interface CommandResult {
  isCommand: boolean
  output: string
}

type CommandHandler = (
  args: string,
  t: Translations,
  ctx: {
    pendingConfirmRef: MutableRefObject<PendingAction | null>
    processCommand: (content: string, t: Translations, bypass: boolean, ref: MutableRefObject<PendingAction | null>) => Promise<CommandResult>
  },
) => Promise<CommandResult>

function ok(output: string): CommandResult {
  return { isCommand: true, output }
}

function err(error: unknown): CommandResult {
  return { isCommand: true, output: `Error: ${(error as Error).message}` }
}

function formatSize(bytes: number): string {
  if (bytes > 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
  if (bytes > 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return bytes + ' B'
}

const handlers: Record<string, CommandHandler> = {
  shell: async (args) => {
    try {
      const result = await window.kora.shell.execute(args)
      const output = result.stdout || result.stderr || '(no output)'
      return ok(`**$ ${args}**\n\`\`\`\n${output}\n\`\`\``)
    } catch (e) { return err(e) }
  },

  file: async (args) => {
    const filePath = args.trim()
    try {
      const content = await window.kora.fs.readFile(filePath)
      const preview = content.length > 3000 ? content.slice(0, 3000) + '\n... (truncated)' : content
      return ok(`**File: ${filePath}**\n\`\`\`\n${preview}\n\`\`\``)
    } catch (e) { return err(e) }
  },

  open: async (args) => {
    const target = args.trim()
    try {
      const result = await window.kora.system.openApp(target)
      return result.success ? ok(`Opened: ${target}`) : ok(`Failed to open: ${result.error}`)
    } catch (e) { return err(e) }
  },

  dir: async (args) => {
    const dirPath = args.trim() || '~'
    try {
      const entries = await window.kora.fs.readDir(dirPath)
      if (entries.length === 0) return ok(`**${dirPath}** — empty directory`)
      const lines = entries.map((e) => `${e.isDirectory ? '📁' : '📄'} ${e.name}`)
      return ok(`**${dirPath}** (${entries.length} items)\n${lines.join('\n')}`)
    } catch (e) { return err(e) }
  },

  write: async (args) => {
    const spaceIdx = args.indexOf(' ')
    if (spaceIdx === -1) return ok('Usage: `!write <path> <content>`')
    const filePath = args.slice(0, spaceIdx)
    const securityErr = validatePath(filePath)
    if (securityErr) return ok(`⚠️ Security: ${securityErr}`)
    const content = args.slice(spaceIdx + 1)
    try {
      await window.kora.fs.writeFile(filePath, content)
      return ok(`Written to **${filePath}** (${content.length} chars)`)
    } catch (e) { return err(e) }
  },

  rename: async (args) => {
    const spaceIdx = args.indexOf(' ')
    if (spaceIdx === -1) return ok('Usage: `!rename <old_path> <new_path>`')
    const oldPath = args.slice(0, spaceIdx)
    const newPath = args.slice(spaceIdx + 1)
    const secOld = validatePath(oldPath)
    if (secOld) return ok(`⚠️ Security: ${secOld}`)
    const secNew = validatePath(newPath)
    if (secNew) return ok(`⚠️ Security: ${secNew}`)
    try {
      await window.kora.fs.rename(oldPath, newPath)
      return ok(`Renamed **${oldPath}** → **${newPath}**`)
    } catch (e) { return err(e) }
  },

  delete: async (args) => {
    const filePath = args.trim()
    const securityErr = validatePath(filePath)
    if (securityErr) return ok(`⚠️ Security: ${securityErr}`)
    try {
      await window.kora.fs.deleteFile(filePath)
      return ok(`Deleted: **${filePath}**`)
    } catch (e) { return err(e) }
  },

  mkdir: async (args) => {
    const dirPath = args.trim()
    const securityErr = validatePath(dirPath)
    if (securityErr) return ok(`⚠️ Security: ${securityErr}`)
    try {
      await window.kora.fs.mkdir(dirPath)
      return ok(`Created directory: **${dirPath}**`)
    } catch (e) { return err(e) }
  },

  stat: async (args) => {
    const filePath = args.trim()
    try {
      const s = await window.kora.fs.stat(filePath)
      const type = s.isDirectory ? 'Directory' : 'File'
      return ok([
        `**${filePath}**`,
        `Type: ${type}`,
        `Size: ${formatSize(s.size)}`,
        `Created: ${s.created}`,
        `Modified: ${s.modified}`,
      ].join('\n'))
    } catch (e) { return err(e) }
  },

  exists: async (args) => {
    const filePath = args.trim()
    try {
      const result = await window.kora.fs.exists(filePath)
      return ok(result.exists ? `**${filePath}** exists` : `**${filePath}** does not exist`)
    } catch (e) { return err(e) }
  },

  help: async (_args, t) => {
    return ok([
      `**${t.help.title}**`,
      '',
      `\`!shell <command>\` — ${t.help.shell}`,
      `\`!file <path>\` — ${t.help.file}`,
      `\`!open <path>\` — ${t.help.open}`,
      `\`!dir <path>\` — ${t.help.dir}`,
      `\`!write <path> <content>\` — ${t.help.write}`,
      `\`!rename <old> <new>\` — ${t.help.rename}`,
      `\`!delete <path>\` — ${t.help.delete}`,
      `\`!mkdir <path>\` — ${t.help.mkdir}`,
      `\`!stat <path>\` — ${t.help.stat}`,
      `\`!exists <path>\` — ${t.help.exists}`,
      `\`!calc <expr>\` — ${t.commands.calc}`,
      `\`!random <min> <max>\` — ${t.commands.random}`,
      `\`!uuid\` — ${t.commands.uuid}`,
      `\`!time\` — ${t.commands.time}`,
      '',
      '**🧰 System Control:**',
      '`!shutdown` — Shut down PC',
      '`!restart` — Restart PC',
      '`!sleep` — Put PC to sleep',
      '`!lock` — Lock screen',
      '`!volume <0-100>` — Set volume',
      '`!mute` — Toggle mute',
      '`!brightness <0-100>` — Set brightness',
      '`!windows` — List open windows',
      '`!find <pattern>` — Search files',
      '`!clipboard [text]` — Read/write clipboard',
      '`!search <query>` — Search the web',
      '`!confirm` / `!deny` — Confirm/cancel dangerous action',
      '',
      `\`!help\` — ${t.help.helpCmd}`,
      '',
      t.help.typeHint,
    ].join('\n'))
  },

  calc: async (args) => {
    const expr = args.trim()
    const sanitized = expr.replace(/[^0-9+\-*/.()%\s]/g, '')
    if (!sanitized) return ok('**🧮 Calc:** No valid expression')
    try {
      const result = parseCalc(sanitized.replace(/\s+/g, ''))
      if (typeof result === 'number' && isFinite(result)) {
        return ok(`**🧮 Calc:** \`${expr}\` = **${Math.round(result * 1e10) / 1e10}**`)
      }
      return ok('**🧮 Calc:** Invalid expression')
    } catch {
      return ok('**🧮 Calc:** Error evaluating expression')
    }
  },

  random: async (args) => {
    const parts = args.trim().split(/\s+/)
    const min = parseInt(parts[0]) || 0
    const max = parseInt(parts[1]) || 100
    if (min > max) return ok('Min must be <= max')
    const result = Math.floor(Math.random() * (max - min + 1)) + min
    return ok(`**🎲 Random:** ${result} (${min}–${max})`)
  },

  uuid: async () => ok(`**🔑 UUID:** \`${crypto.randomUUID()}\``),

  time: async () => ok(`**🕐 Time:** ${new Date().toLocaleString()}`),

  sleep: async () => {
    try { await window.kora.system.sleep(); return ok('💤 Going to sleep...') }
    catch (e) { return err(e) }
  },

  lock: async () => {
    try { await window.kora.system.lock(); return ok('🔒 Screen locked') }
    catch (e) { return err(e) }
  },

  volume: async (args) => {
    const level = parseInt(args.trim())
    if (isNaN(level) || level < 0 || level > 100) return ok('Usage: `!volume <0-100>`')
    try {
      const r = await window.kora.system.volume(level)
      return r.success ? ok(`**🔊 Volume:** ${r.volume}%`) : ok(`Failed to set volume: ${r.error}`)
    } catch (e) { return err(e) }
  },

  mute: async () => {
    try { await window.kora.system.mute(); return ok('**🔇 Muted**') }
    catch (e) { return err(e) }
  },

  brightness: async (args) => {
    const level = parseInt(args.trim())
    if (isNaN(level) || level < 0 || level > 100) return ok('Usage: `!brightness <0-100>`')
    try {
      const r = await window.kora.system.brightness(level)
      return r.success ? ok(`**☀️ Brightness:** ${r.brightness}%`) : ok(`Failed to set brightness: ${r.error}`)
    } catch (e) { return err(e) }
  },

  windows: async () => {
    try {
      const wins = await window.kora.system.windows()
      if (wins.length === 0) return ok('No open windows found')
      const list = wins.map((w, i) => `${i + 1}. **${w.title}** (PID: ${w.pid})`).join('\n')
      return ok(`**🪟 Open Windows (${wins.length}):**\n${list}`)
    } catch (e) { return err(e) }
  },

  find: async (args) => {
    const pattern = args.trim()
    try {
      const result = await window.kora.fs.findFiles(pattern, { maxResults: 50 })
      if (!result.success) return ok(`Error: ${result.error}`)
      if (result.results.length === 0) return ok(`No files found matching \`${pattern}\``)
      const preview = result.results.slice(0, 30).map((f) => `📄 ${f}`).join('\n')
      const more = result.results.length > 30 ? `\n... and ${result.results.length - 30} more` : ''
      return ok(`**🔗 Found ${result.results.length} files matching \`${pattern}\`:**\n${preview}${more}`)
    } catch (e) { return err(e) }
  },

  search: async (args) => {
    const query = args.trim()
    try {
      const results = await window.kora.web.search(query)
      if (results.length === 0) return ok(`No results for "${query}"`)
      const items = results.map((r, i) =>
        `${i + 1}. **[${r.title}](${r.url})**\n   ${r.snippet}`
      ).join('\n\n')
      return ok(`**🌐 Web Search: \`${query}\`**\n\n${items}`)
    } catch (e) { return ok(`Search error: ${(e as Error).message}`) }
  },

  clipboard: async (args) => {
    const text = args.trim()
    try {
      if (text) {
        await window.kora.clipboard.write(text)
        return ok(`**📋 Clipboard:** Written (${text.length} chars)`)
      }
      const content = await window.kora.clipboard.read()
      const preview = content.length > 500 ? content.slice(0, 500) + '...' : content
      return ok(`**📋 Clipboard:**\n\`\`\`\n${preview}\n\`\`\``)
    } catch (e) { return err(e) }
  },

  confirm: async (_args, t, ctx) => {
    if (!ctx.pendingConfirmRef.current) return ok('Nothing to confirm.')
    const action = ctx.pendingConfirmRef.current
    ctx.pendingConfirmRef.current = null
    try {
      if (action.type === 'shutdown') { await window.kora.system.shutdown(); return ok('⚠️ Shutting down PC...') }
      if (action.type === 'restart') { await window.kora.system.restart(); return ok('⚠️ Restarting PC...') }
      if (action.type === 'command' && action.args[0]) {
        return ctx.processCommand(action.args[0], t, true, ctx.pendingConfirmRef)
      }
      return ok(`Executed: ${action.description}`)
    } catch (e) { return err(e) }
  },

  deny: async (_args, _t, ctx) => {
    if (!ctx.pendingConfirmRef.current) return ok('Nothing to deny.')
    ctx.pendingConfirmRef.current = null
    return ok('✅ Cancelled.')
  },
}

export function getCommandHandler(name: string): CommandHandler | undefined {
  return handlers[name]
}

export const DANGEROUS_COMMANDS = new Set(['shell', 'file', 'delete', 'write', 'rename', 'mkdir', 'open', 'shutdown', 'restart'])

export function describeDangerousCommand(cmd: string, args: string): string {
  switch (cmd) {
    case 'shell': return `Run shell command: \`${args}\``
    case 'file': return `Read file: ${args.trim()}`
    case 'delete': return `Delete: ${args.trim()}`
    case 'write': return `Write to file: ${args.trim().split(' ')[0]}`
    case 'rename': return `Rename/move: ${args.trim()}`
    case 'mkdir': return `Create directory: ${args.trim()}`
    case 'open': return `Open: ${args.trim()}`
    case 'shutdown': return 'Shut down the PC'
    case 'restart': return 'Restart the PC'
    default: return args
  }
}

function parseCalc(input: string): number {
  let pos = 0
  const peek = (): string => input[pos] ?? ''
  const eat = (): string => input[pos++]

  function parseNumber(): number {
    const start = pos
    while (/[0-9.]/.test(peek())) eat()
    const raw = input.slice(start, pos)
    if (!raw) throw new Error('expected number')
    const n = Number(raw)
    if (isNaN(n)) throw new Error('bad number')
    return n
  }

  function parseAtom(): number {
    const ch = peek()
    if (ch === '(') { eat(); const v = parseAddSub(); if (eat() !== ')') throw new Error('expected )'); return v }
    if (ch === '-') { eat(); return -parseAtom() }
    if (ch === '+') { eat(); return parseAtom() }
    return parseNumber()
  }

  function parseMulDiv(): number {
    let v = parseAtom()
    for (;;) {
      const op = peek()
      if (op === '*') { eat(); v *= parseAtom() }
      else if (op === '/') { eat(); const d = parseAtom(); if (d === 0) throw new Error('division by zero'); v /= d }
      else if (op === '%') { eat(); v %= parseAtom() }
      else return v
    }
  }

  function parseAddSub(): number {
    let v = parseMulDiv()
    for (;;) {
      const op = peek()
      if (op === '+') { eat(); v += parseMulDiv() }
      else if (op === '-') { eat(); v -= parseMulDiv() }
      else return v
    }
  }

  return parseAddSub()
}
