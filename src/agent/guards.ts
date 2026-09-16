// Fault-tolerance primitives ported from Hermes agent (Nous Research, MIT):
// error_classifier, tool_guardrails, repetition_guard, empty_response_guard,
// iteration_budget. Kept side-effect-free for reuse.

export type FailoverReason =
  | 'none'
  | 'rate_limit'
  | 'auth'
  | 'model_not_found'
  | 'context_overflow'
  | 'server_error'
  | 'network'
  | 'timeout'

const REASON_REGEX = /\[kora:(\w+)\]/

export function parseLlmErrorReason(err: unknown): FailoverReason {
  const message = err instanceof Error ? err.message : String(err ?? '')
  const m = message.match(REASON_REGEX)
  const reason = m?.[1] as FailoverReason | undefined
  if (
    reason &&
    ['none', 'rate_limit', 'auth', 'model_not_found', 'context_overflow', 'server_error', 'network', 'timeout'].includes(reason)
  ) {
    return reason
  }
  return 'none'
}

export function isRetryableReason(reason: FailoverReason): boolean {
  return reason === 'rate_limit' || reason === 'server_error' || reason === 'network' || reason === 'timeout'
}

export function backoffDelayMs(attempt: number): number {
  const base = Math.min(15000, 1000 * Math.pow(2, Math.max(1, attempt) - 1))
  const jitter = base * (0.7 + Math.random() * 0.6)
  return Math.round(jitter)
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * IterationBudget — consume/refund step counter (port of iteration_budget.py).
 */
export class IterationBudget {
  private total: number
  private used = 0

  constructor(total: number) {
    this.total = Math.max(1, total)
  }

  consume(n = 1): boolean {
    if (this.used + n > this.total) return false
    this.used += n
    return true
  }

  refund(n = 1): void {
    this.used = Math.max(0, this.used - n)
  }

  get remaining(): number {
    return this.total - this.used
  }
}

function hashValue(v: unknown): string {
  let s: string
  try {
    s = JSON.stringify(v, (_k, val) =>
      val && typeof val === 'object' && !Array.isArray(val)
        ? Object.fromEntries(Object.entries(val).sort(([a], [b]) => a.localeCompare(b)))
        : val,
    ) ?? String(v)
  } catch {
    s = String(v)
  }
  let h = 0
  for (let i = 0; i < s.length; i++) h = ((h * 31 + s.charCodeAt(i)) >>> 0)
  return String(h)
}

interface LoopRecord {
  callKey: string
  resultKey: string
}

/**
 * ToolLoopGuard — detects repeated identical tool calls and same-tool streaks
 * (port of tool_guardrails.py). Returns a synthetic observation message for
 * the model instead of hard-stopping the loop.
 */
export class ToolLoopGuard {
  private records: LoopRecord[] = []
  private notified = new Set<string>()
  private readonly maxRecords = 24

  record(tool: string, parameters: unknown, result: unknown): void {
    this.records.push({
      callKey: `${tool}|${hashValue(parameters)}`,
      resultKey: hashValue(result),
    })
    if (this.records.length > this.maxRecords) this.records.shift()
  }

  /** Returns a warning message to inject into the conversation, or null. */
  check(): string | null {
    const n = this.records.length
    if (n < 2) return null

    const last = this.records[n - 1]

    // exact identical consecutive calls with identical results
    let identicalStreak = 1
    for (let i = n - 2; i >= 0; i--) {
      const r = this.records[i]
      if (r.callKey === last.callKey && r.resultKey === last.resultKey) identicalStreak++
      else break
    }
    if (identicalStreak >= 2) {
      const stamp = `exact:${last.callKey}:${identicalStreak >= 5 ? '5' : identicalStreak}`
      if (!this.notified.has(stamp)) {
        this.notified.add(stamp)
        if (identicalStreak >= 5) {
          return (
            `TOOL LOOP DETECTED: you called the same tool with the same arguments ${identicalStreak} times ` +
            'with identical results. Stop calling this tool. Either finish with your best answer via {"action":"finish"} or try a fundamentally different approach.'
          )
        }
        return (
          `You already made this exact tool call ${identicalStreak} times and got the same result. ` +
          'Do NOT repeat it: change the arguments, try another tool, or finish with the information you have.'
        )
      }
    }

    // same tool streak regardless of arguments
    const toolName = last.callKey.slice(0, last.callKey.indexOf('|'))
    let toolStreak = 1
    for (let i = n - 2; i >= 0; i--) {
      const r = this.records[i]
      if (r.callKey.startsWith(toolName + '|')) toolStreak++
      else break
    }
    if (toolStreak >= 4) {
      const stamp = `tool:${toolName}:${toolStreak >= 6 ? '6' : toolStreak}`
      if (!this.notified.has(stamp)) {
        this.notified.add(stamp)
        return (
          `WARNING: this is your ${toolStreak}th consecutive call of "${toolName}". ` +
          'Consider whether you are making progress; combine what you have and finish, or switch strategy.'
        )
      }
    }

    return null
  }

  reset(): void {
    this.records = []
    this.notified.clear()
  }
}

/**
 * detectDegenerateRepetition — catches degenerate model outputs where a short
 * phrase is repeated over and over (port of repetition_guard.py).
 */
export function detectDegenerateRepetition(text: string): boolean {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (normalized.length < 120) return false

  const windows = [80, 50, 30]
  for (const w of windows) {
    if (normalized.length <= w) continue
    const tail = normalized.slice(-w)
    let count = 0
    let idx = normalized.indexOf(tail)
    while (idx !== -1) {
      count++
      idx = normalized.indexOf(tail, idx + Math.floor(w / 2))
    }
    if (count >= 3 || (count >= 2 && (count * w) / normalized.length >= 0.5)) {
      return true
    }
  }
  return false
}

/**
 * isEmptyResponse — deterministic empty-model-output detection
 * (port of empty_response_guard.py).
 */
export function isEmptyResponse(text: unknown): boolean {
  return typeof text !== 'string' || text.trim().length === 0
}

/**
 * boundToolError — caps tool error text so a single failure cannot flood the
 * model context (port of registry._bound_error_text).
 */
export function boundToolError(err: unknown, max = 2048): string {
  const raw = err instanceof Error ? err.message : typeof err === 'string' ? err : safeStringify(err)
  const s = raw.length > max ? raw.slice(0, max) + `… [truncated ${raw.length - max} chars]` : raw
  return s
}

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v) ?? String(v)
  } catch {
    return '[unserializable error]'
  }
}
