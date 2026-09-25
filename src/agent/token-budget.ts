/**
 * Token budget for agent history (ROADMAP Phase 0: "token budget +
 * summarisation for memory — today history is trimmed by entry count only").
 *
 * Pure functions over MemoryEntry-shaped records so both the orchestrator and
 * the tests use exactly the same code. The estimate is the standard ~4 chars
 * per token heuristic plus a small per-message overhead for roles/markup —
 * deliberately cheap and deterministic; it does not need to match any
 * specific tokenizer, only to bound context size predictably.
 */

export interface BudgetEntry {
  role: string
  content: string
  timestamp?: number
}

export interface BudgetFit<T extends BudgetEntry> {
  /** Newest entries that fit the budget (always includes keepRecent tail). */
  kept: T[]
  /** How many oldest entries were dropped (0 = nothing dropped). */
  droppedCount: number
  /** Concatenated content of the dropped entries — input for summarisation. */
  droppedText: string
  /** Total estimated tokens of `kept`. */
  keptTokens: number
}

/** Deterministic token estimate: ceil(chars / 4) + 1 per message. */
export function estimateTokens(text: string): number {
  if (!text) return 0
  return Math.ceil(text.length / 4) + 1
}

export function entryTokens(entry: BudgetEntry): number {
  return estimateTokens(entry.content) + 4 // role + message framing
}

/**
 * Fit `entries` (oldest → newest) into `budget` tokens, dropping the OLDEST
 * entries first and always keeping the newest `keepRecent` ones so the model
 * never loses the immediate exchange even if a single entry exceeds budget.
 */
export function fitToTokenBudget<T extends BudgetEntry>(
  entries: T[],
  budget: number,
  keepRecent = 4,
): BudgetFit<T> {
  const tail = Math.max(1, keepRecent)
  if (entries.length <= tail) {
    return { kept: [...entries], droppedCount: 0, droppedText: '', keptTokens: sumTokens(entries) }
  }

  // Always keep the tail; walk backwards from it, spending the budget.
  const keptRev: T[] = []
  const dropped: T[] = []
  let tokens = 0
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i]
    const isTail = i >= entries.length - tail
    const cost = entryTokens(e)
    if (isTail || tokens + cost <= budget) {
      keptRev.push(e)
      tokens += cost
    } else {
      dropped.push(e)
    }
  }

  const kept = keptRev.reverse()
  dropped.reverse()
  return {
    kept,
    droppedCount: dropped.length,
    droppedText: dropped.map((e) => `${e.role}: ${e.content}`).join('\n').slice(0, 8000),
    keptTokens: tokens,
  }
}

function sumTokens(entries: BudgetEntry[]): number {
  return entries.reduce((acc, e) => acc + entryTokens(e), 0)
}
