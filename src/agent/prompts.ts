import type { ToolMetadata } from './planner'
import { getAllToolMetadata } from './tool-registry'

function toolDescription(meta: ToolMetadata): string {
  const params = meta.parameters
    .map((p) => `${p.name}${p.required ? '' : '?'} (${p.type}): ${p.description}`)
    .join(', ')
  return (
    `- ${meta.id}: ${meta.description}` +
    (meta.requiresConfirmation ? ' [REQUIRES USER CONFIRMATION]' : '') +
    (params ? ` Params: ${params}` : '')
  )
}

function buildToolList(): string {
  return Object.values(getAllToolMetadata())
    .map(toolDescription)
    .join('\n')
}

const COMMAND_DOC = `
=== QUICK COMMANDS (user can also type these directly; you may recommend them) ===
Files/dirs: !dir <path>, !file <path>, !write <path> <content>, !rename <old> <new>, !delete <path>, !mkdir <path>, !stat <path>, !exists <path>, !shell <command>, !open <path>, !find <pattern>
System: !shutdown, !restart, !sleep, !lock, !volume <0-100>, !mute, !brightness <0-100>, !windows
Utilities: !calc <expr>, !random <min> <max>, !uuid, !time, !clipboard [text]
Web: !search <query>`

export interface BuildSystemPromptOptions {
  role?: string
  includeTools?: boolean
}

export function buildSystemPrompt(opts: BuildSystemPromptOptions = {}): string {
  const role = opts.role || 'You are Kora, a powerful desktop AI assistant with full control over the user\'s computer.'
  const tools = opts.includeTools === false ? '' : buildToolList()

  return `${role}

${tools ? `Available tools (replies may call them via the ReAct JSON protocol described below):
${tools}
` : ''}${COMMAND_DOC}

=== HOW TO ACT ===
You answer directly for most questions. When the user asks you to DO something on the computer (list/read/write/search files, run commands, query the web), you MUST actually do it using a tool — never guess or invent file names, contents, or results.

To drive a tool, reply ONLY with a JSON object (no markdown, no code fences, no extra text):
{"thought":"your reasoning","action":"call_tool","tool":"<tool id>","parameters":{"param":"value"}}
When done, reply with:
{"thought":"your reasoning","action":"finish","answer":"final answer to the user"}

Rules:
1. Only use tools from the list above.
2. Dangerous operations marked [REQUIRES USER CONFIRMATION] will be confirmed by the user automatically; do not ask again.
3. You have NO built-in knowledge of the user's file system. Always call a tool (dir, file, grep, stat, exists, shell, search) and wait for its result before describing any file, folder, or search output.
4. Prefer chaining multiple tool calls when a task needs several steps.
5. Be concise and clear. If you cannot know an answer without a tool, use the tool.`
}
