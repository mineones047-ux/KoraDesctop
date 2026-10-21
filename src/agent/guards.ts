// Fault-tolerance primitives ported from Hermes agent (Nous Research, MIT):
// error_classifier, tool_guardrails, repetition_guard, empty_response_guard,
// iteration_budget. Kept side-effect-free for reuse.

/**
 * Why an LLM call failed, as classified by the main process.
 *
 * The reason is carried inside the error message as a `[kora:<reason>]` marker, because
 * that survives every transport between the provider and here — it is a contract, not an
 * object. `none` is the deliberate catch-all: an unrecognised marker must never be treated
 * as retryable, or a permanent failure (a bad API key, a typo'd model) becomes an infinite
 * retry loop that hammers someone's billing endpoint.
 */
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

/**
 * Extract the failure reason from an error, defaulting to `'none'`.
 *
 * The value is validated against the known set rather than cast: the marker comes from a
 * provider response and a future gateway could emit something else, which must degrade to
 * "don't retry" rather than to a branch nobody wrote.
 */
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

/**
 * Is this failure worth retrying?
 *
 * Only transient causes qualify. `auth`, `model_not_found` and `context_overflow` are
 * excluded on purpose: retrying them is pure cost, and the caller handles context overflow
 * by trimming history instead of by asking again.
 */
export function isRetryableReason(reason: FailoverReason): boolean {
  return reason === 'rate_limit' || reason === 'server_error' || reason === 'network' || reason === 'timeout'
}

/**
 * Exponential backoff with jitter, capped at 15 s.
 *
 * The jitter is the important half: without it, every client that hit a rate limit at the
 * same moment retries at the same moment, and the thundering herd keeps the limit in place.
 */
export function backoffDelayMs(attempt: number): number {
  const base = Math.min(15000, 1000 * Math.pow(2, Math.max(1, attempt) - 1))
  const jitter = base * (0.7 + Math.random() * 0.6)
  return Math.round(jitter)
}

/** Abortable-free delay between retry attempts. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * IterationBudget — consume/refund step counter (port of iteration_budget.py).
 */
/**
 * Steps remaining in this cycle.
 *
 * `refund` exists because not every step is a real step: a step consumed by a model that
 * returned malformed JSON should not count against the user as much as one that ran a tool.
 */
export class IterationBudget {
  private total: number
  private used = 0

  /** Build a budget; the total is clamped to at least one usable step. */
  constructor(total: number) {
    // A budget of zero would refuse every first step, so clamp to at least one.
    this.total = Math.max(1, total)
  }

  /** Spend `n` steps; returns false (and spends nothing) if the budget cannot cover it. */
  consume(n = 1): boolean {
    if (this.used + n > this.total) return false
    this.used += n
    return true
  }

  /** Give steps back — used when a retry consumed budget without doing real work. */
  refund(n = 1): void {
    this.used = Math.max(0, this.used - n)
  }

  get remaining(): number {
    return this.total - this.used
  }
}

/**
 * Stable content hash, used to recognise "the same call with the same result".
 *
 * The JSON replacer sorts object keys so that `{a:1,b:2}` and `{b:2,a:1}` hash the same —
 * without it the model re-sending identical parameters in a different key order would look
 * like a new call and the loop guard would never fire.
 *
 * This is a 32-bit djb2-style hash, not a cryptographic one. Collisions would mean a
 * spurious "you already did this" warning, so a weak hash is an acceptable trade here.
 */
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

/** One remembered call: what was asked (hashed) and what came back (hashed). */
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

  /** Remember a completed call, keeping a bounded window (oldest dropped first). */
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

  /** Clear the window at the start of a new cycle, so an old streak cannot taint it. */
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

/** JSON-stringify anything, including values `JSON.stringify` would throw on. */
function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v) ?? String(v)
  } catch {
    return '[unserializable error]'
  }
}
