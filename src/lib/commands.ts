/**
 * `!` commands typed by the user in the chat (executed by useChat, no LLM involved).
 *
 * Commands listed in DANGEROUS_COMMANDS require an explicit `!confirm`; the
 * confirmed retry runs with bypassConfirm=true so the user is not asked twice.
 * `!calc` is a hand-written recursive-descent parser — never use eval here.
 * Paths are pre-checked with validatePath(); the main process re-checks anyway.
 */
import type { Translations } from '../i18n/en'
import type { MutableRefObject } from 'react'
import { validatePath } from './path-security'

/** A dangerous action parked in the confirmation slot, waiting for `!confirm`/`!deny`. */
export interface PendingAction {
  type: string
  args: string[]
  description: string
}

/** What the chat shows after a `!` command: `isCommand` tells the caller not to call the LLM. */
export interface CommandResult {
  isCommand: boolean
  output: string
}

/**
 * One `!` command's implementation.
 *
 * `processCommand` is passed into the context so a command can re-enter the dispatcher —
 * that is how `!confirm` retries the parked action with `bypassConfirm`, and how
 * `!deny` discards it. Going back through the dispatcher (rather than calling the handler
 * directly) is what guarantees the retry cannot re-prompt for a command the user already
 * approved, and cannot skip the check for one they did not.
 */
type CommandHandler = (
  args: string,
  t: Translations,
  ctx: {
    pendingConfirmRef: MutableRefObject<PendingAction | null>
    processCommand: (content: string, t: Translations, bypass: boolean, ref: MutableRefObject<PendingAction | null>) => Promise<CommandResult>
  },
) => Promise<CommandResult>

/** A successful command result. Failures are *results*, not throws — see the file header. */
function ok(output: string): CommandResult {
  return { isCommand: true, output }
}

/** Render any thrown value as a command error, so one bad call never breaks the chat. */
function err(error: unknown): CommandResult {
  return { isCommand: true, output: `Error: ${(error as Error).message}` }
}

/** Human-readable byte count for `!stat`. */
function formatSize(bytes: number): string {
  if (bytes > 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
  if (bytes > 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return bytes + ' B'
}

/**
 * Every `!` command, keyed by name.
 *
 * `help` is written out in full here rather than derived from this table, so the ordering
 * and grouping of the help text stay stable instead of shuffling whenever a tool is added.
 */
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

/** Look up a command by name; `undefined` means the text is not a known `!command`. */
export function getCommandHandler(name: string): CommandHandler | undefined {
  return handlers[name]
}

/**
 * Commands that require an explicit `!confirm` before they run.
 *
 * A second layer, not the only one: the main process re-checks the path and the shell
 * denylist. This list exists so a *user-typed* command gets a clear prompt rather than a
 * refusal, and so the prompt can say what is about to happen.
 */
export const DANGEROUS_COMMANDS = new Set(['shell', 'file', 'delete', 'write', 'rename', 'mkdir', 'open', 'shutdown', 'restart'])

/**
 * One line describing what a pending command would do, shown in the `!confirm` prompt.
 *
 * Localised: this sentence is the only thing standing between the user and a destructive
 * action, so it has to be readable in whatever language the UI is in.
 */
export function describeDangerousCommand(cmd: string, args: string, t: Translations): string {
  const arg = args.trim()
  switch (cmd) {
    case 'shell': return t.danger.shell.replace('{args}', args)
    case 'file': return t.danger.file.replace('{args}', arg)
    case 'delete': return t.danger.delete.replace('{args}', arg)
    case 'write': return t.danger.write.replace('{args}', arg.split(' ')[0] ?? '')
    case 'rename': return t.danger.rename.replace('{args}', arg)
    case 'mkdir': return t.danger.mkdir.replace('{args}', arg)
    case 'open': return t.danger.open.replace('{args}', arg)
    case 'shutdown': return t.danger.shutdown
    case 'restart': return t.danger.restart
    default: return args
  }
}

/**
 * A hand-written recursive-descent arithmetic parser for `!calc`.
 *
 * **Never** `eval`, and never a library that evaluates expressions. The input is typed by
 * a user but sits in a path where a dynamic-code path would be a real injection surface,
 * and the arithmetic here needs nothing more than these four precedence levels.
 *
 * Grammar: `add := mul (('+'|'-') mul)*`, `mul := atom (('*'|'/'|'%') atom)*`,
 * `atom := number | '(' add ')' | ('+'|'-') atom`.
 */
function parseCalc(input: string): number {
  let pos = 0
  const peek = (): string => input[pos] ?? ''
  const eat = (): string => input[pos++]

  /** A numeric literal, consuming digits and at most one decimal point. */
  function parseNumber(): number {
    const start = pos
    while (/[0-9.]/.test(peek())) eat()
    const raw = input.slice(start, pos)
    if (!raw) throw new Error('expected number')
    const n = Number(raw)
    if (isNaN(n)) throw new Error('bad number')
    return n
  }

  /** Parenthesised sub-expression or a unary sign. */
  function parseAtom(): number {
    const ch = peek()
    if (ch === '(') { eat(); const v = parseAddSub(); if (eat() !== ')') throw new Error('expected )'); return v }
    if (ch === '-') { eat(); return -parseAtom() }
    if (ch === '+') { eat(); return parseAtom() }
    return parseNumber()
  }

  /** `*`, `/`, `%` — left-associative, with an explicit zero check. */
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

  /** `+` and `-`, the lowest-precedence level. */
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
