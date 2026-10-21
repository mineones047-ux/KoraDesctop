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
  // Chinese — deliberately WITHOUT `\b`: CJK has no spaces between words and its
  // characters are not `\w`, so a word boundary would simply never match and every
  // Chinese request would silently bypass the agent loop.
  /列出|查看|读取|打开|查找|搜索|创建|新建|删除|移除|重命名|移动|复制|写入|文件|文件夹|目录/,
  /运行|执行|安装|启动|停止|关闭|重启|关机|锁屏|睡眠|音量|亮度|进程/,
  /上网|联网|网上|天气|新闻|搜一下|查一下/,
  /(?:有什么|有啥|都有什么|里面有什么|桌面上)/,
  // Machine state and documents — phrased the way people actually ask ("看看电脑的
  // CPU 和内存", "总结一下笔记"), not as bare keywords.
  /内存|硬盘|磁盘|系统状态|电脑状态|看看电脑|看看系统/,
  /笔记|总结|整理|翻译|清理磁盘/,
]

const PATH_RE = /(?:[A-Za-z]:\\|~(?:\/|\\)|\/Users\/|\/home\/)/

/** Is this text a direct `!command` rather than a message for the model? */
export function isCommandMessage(text: string): boolean {
  return COMMAND_RE.test(text)
}

/** Does the text read like a request that needs a tool (a path, or a task verb)? */
export function hasToolIntent(text: string): boolean {
  // A literal path in the text is a strong enough signal on its own — no keyword needed.
  if (PATH_RE.test(text)) return true
  return TOOL_INTENT_PATTERNS.some((re) => re.test(text))
}

const CONVERSATIONAL_OVERRIDES: RegExp[] = [
  /\b(как ты|что ты умеешь|who are you|how are you|привет|hello|hi|спасибо|thanks)\b/i,
  // Chinese small talk must not start an agent cycle: no `\b` for the reason above.
  /你好|您好|哈喽|你是谁|你会什么|谢谢|麻烦了|在吗|早上好|晚上好/,
]

/**
 * Should this message start an agent cycle?
 *
 * The routing decision, and deliberately conservative in both directions: an explicit
 * `!command` goes to the command handler, and clear small talk ("hi", "what can you do")
 * goes to the chat, so neither pays for an agent loop. Everything in between that looks
 * like a task goes to the agent.
 */
export function needsAgent(text: string): boolean {
  if (COMMAND_RE.test(text)) return false
  if (CONVERSATIONAL_OVERRIDES.some((re) => re.test(text))) return false
  return hasToolIntent(text)
}
