/**
 * Rough token accounting for the composer's context indicator.
 *
 * This is deliberately an estimate: exact counts need the model's tokenizer, which the
 * renderer does not have. The heuristic below is the commonly used ~4 characters per
 * token for Latin text, tightened for CJK where a character is close to one token.
 * The number exists to warn "this chat is getting long", not to bill anyone.
 */

/** One CJK character ≈ one token; four Latin characters ≈ one token. */
export function estimateTokens(text: string): number {
  if (!text) return 0
  let cjk = 0
  let other = 0
  for (const char of text) {
    if (/[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af]/.test(char)) cjk += 1
    else other += 1
  }
  return Math.ceil(cjk + other / 4)
}

/** Total estimate for a list of message contents (system prompt excluded). */
export function estimateMessagesTokens(contents: string[]): number {
  let total = 0
  for (const content of contents) total += estimateTokens(content)
  return total
}

/** `950` → `950`, `1234` → `1.2k`, `1234567` → `1.2M`. */
export function formatTokenCount(tokens: number): string {
  if (!Number.isFinite(tokens) || tokens <= 0) return '0'
  if (tokens < 1000) return String(Math.round(tokens))
  if (tokens < 1_000_000) {
    const value = tokens / 1000
    return `${value < 10 ? value.toFixed(1) : Math.round(value)}k`
  }
  return `${(tokens / 1_000_000).toFixed(1)}M`
}
