// Deterministic intent detector used for auto-routing in the unified chat.
// Decides whether a message is a direct `!` command, a plain conversational
// turn, or an "agentic" request that warrants a tool-using agent loop.

const COMMAND_RE = /^\s*!/

const TOOL_INTENT_PATTERNS: RegExp[] = [
  // files & directories
  /\b(list|show|read|open|find|search|create|delete|rename|move|copy|write|edit|dir|folder|directory|file|файл|папк|каталог|директор|открой|прочитай|покажи|найди|создай|удали|переименуй|скопируй)\b/i,
  // shell / system
  /\b(run|execute|install|start|stop|close|restart|shutdown|lock|sleep|volume|brightness|process|task|exec|выполни|запусти|установи|перезагруз|заблокируй)\b/i,
  // web
  /\b(search|fetch|web|website|internet|погода|новости|поищи|в интернете)\b/i,
  // explicit tool ids in text
  /\b(!(?:shell|dir|file|grep|mkdir|write|rename|delete|open|search))\b/,
  // "what is in ..." / "что в/на ..." path questions
  /\b(?:what(?:'s| is|s) (?:in|inside|on|at)|что (?:в|на|лежит|находится|есть))\b/i,
]

const PATH_RE = /(?:[A-Za-z]:\\|~(?:\/|\\)|\/Users\/|\/home\/)/

export function isCommandMessage(text: string): boolean {
  return COMMAND_RE.test(text)
}

export function hasToolIntent(text: string): boolean {
  if (PATH_RE.test(text)) return true
  return TOOL_INTENT_PATTERNS.some((re) => re.test(text))
}

const CONVERSATIONAL_OVERRIDES: RegExp[] = [
  /\b(как ты|что ты умеешь|who are you|how are you|привет|hello|hi|спасибо|thanks)\b/i,
]

export function needsAgent(text: string): boolean {
  if (COMMAND_RE.test(text)) return false
  if (CONVERSATIONAL_OVERRIDES.some((re) => re.test(text))) return false
  return hasToolIntent(text)
}
